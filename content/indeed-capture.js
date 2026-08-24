(() => {
  "use strict";

  if (globalThis.__brightstarIndeedCaptureLoaded) return;
  globalThis.__brightstarIndeedCaptureLoaded = true;

  const STATE_KEY = "indeed_capture_state";
  const JOBS_KEY = "indeed_captured_jobs";
  const SALESFORCE_TERMS = [
    /\bsalesforce\b/i,
    /\bapex\b/i,
    /\blightning web components?\b/i,
    /\blwc\b/i,
    /\bvisualforce\b/i,
    /\bsales cloud\b/i,
    /\bservice cloud\b/i,
    /\bexperience cloud\b/i,
    /\bcommerce cloud\b/i,
    /\bmarketing cloud\b/i,
    /\bcrm analytics\b/i,
    /\b(?:salesforce )?cpq\b/i,
    /\bmulesoft\b/i
  ];

  let processing = false;
  let stopped = false;

  function cleanText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function textFrom(root, selectors) {
    for (const selector of selectors) {
      const el = root?.querySelector?.(selector);
      const text = cleanText(el?.innerText || el?.textContent);
      if (text) return text;
    }
    return "";
  }

  function absoluteUrl(value) {
    try {
      return new URL(String(value || ""), location.href).toString();
    } catch {
      return "";
    }
  }

  function jobKeyFrom(root, link) {
    const keyed = root?.closest?.("[data-jk]") || root?.querySelector?.("[data-jk]") || root;
    const direct = cleanText(keyed?.getAttribute?.("data-jk"));
    if (direct) return direct;
    try {
      const url = new URL(link);
      return url.searchParams.get("jk") || url.searchParams.get("vjk") || "";
    } catch {
      return "";
    }
  }

  function salesforceRelevance(text) {
    const source = cleanText(text);
    const matchedTerms = SALESFORCE_TERMS.filter((term) => term.test(source)).map((term) =>
      term.source.replace(/\\b|\(\?:|\?|\[|\]|\^|\$|\\/g, "")
    );
    return {
      relevant: matchedTerms.length > 0,
      matchedTerms: [...new Set(matchedTerms)]
    };
  }

  function hasHostedApply(root, text) {
    if (
      root?.querySelector?.(
        '#indeedApplyButton, [data-testid*="indeedApply"], [data-testid*="indeed-apply"], button[id*="indeedApply"], a[id*="indeedApply"], a[href*="/applystart"], form[action*="/applystart"]'
      )
    ) {
      return true;
    }
    return /\beasily apply\b|\bapply on indeed\b/i.test(cleanText(text));
  }

  function applyEvidence(root, text) {
    if (hasHostedApply(root, text)) return "hosted";
    const controls = [
      ...(root?.querySelectorAll?.("a[href], button[formaction]") || [])
    ].filter((el) => /apply/i.test(cleanText(el.textContent || el.getAttribute?.("aria-label"))));
    const external = controls.some((el) => {
      const target = el.href || el.getAttribute?.("formaction") || "";
      if (!target) return false;
      try {
        return !/(^|\.)indeed\.com$/i.test(new URL(target, location.href).hostname);
      } catch {
        return false;
      }
    });
    if (external || /\bapply (?:directly )?on (?:the )?company (?:site|website)\b/i.test(cleanText(text))) {
      return "external";
    }
    return "unknown";
  }

  function detectGate() {
    const bodyText = cleanText(document.body?.innerText).slice(0, 12000);
    const href = location.href;
    const passwordInput = document.querySelector('form input[type="password"]');
    if (
      /\/account\/login|\/account\/register/i.test(href) ||
      (passwordInput && passwordInput.getClientRects().length > 0)
    ) {
      return { type: "login_required", message: "Indeed sign-in is required" };
    }
    if (
      /captcha|verify (?:that )?you(?:'re| are) (?:a )?human|unusual traffic|security check/i.test(
        bodyText
      ) ||
      document.querySelector('iframe[src*="captcha"], [class*="captcha"], [id*="captcha"]')
    ) {
      return { type: "captcha", message: "Indeed CAPTCHA or human verification detected" };
    }
    if (
      /\brate limit\b|too many requests|temporarily blocked|try again later|request was blocked/i.test(
        bodyText
      )
    ) {
      return { type: "rate_limited", message: "Indeed rate limiting detected" };
    }
    return null;
  }

  function scrapeSearchResults() {
    const nodes = [
      ...document.querySelectorAll(
        ".job_seen_beacon, .jobsearch-ResultsList > li, [data-testid='slider_item'], .result"
      )
    ];
    const found = new Map();

    for (const root of nodes) {
      const anchor =
        root.querySelector("h2 a[href], a[data-jk][href], a[href*='/viewjob'][href]") ||
        root.closest?.("a[href*='/viewjob']");
      const link = absoluteUrl(anchor?.href);
      const jobKey = jobKeyFrom(root, link);
      if (!link || (!jobKey && !/\/viewjob/i.test(link))) continue;

      const title =
        cleanText(anchor?.getAttribute("aria-label")) ||
        textFrom(root, [".jobTitle", "h2", "[data-testid='job-title']"]);
      const company = textFrom(root, [
        "[data-testid='company-name']",
        ".companyName",
        "[data-testid='companyName']"
      ]);
      const locationText = textFrom(root, [
        "[data-testid='text-location']",
        ".companyLocation",
        "[data-testid='job-location']"
      ]);
      const snippet = textFrom(root, [
        ".job-snippet",
        "[data-testid='jobsnippet_footer']",
        "[data-testid='job-snippet']"
      ]);
      const postedText = textFrom(root, [
        "[data-testid='myJobsStateDate']",
        "span.date",
        ".date",
        "[class*='date']"
      ]);
      const cardText = cleanText(root.innerText || root.textContent);
      const relevance = salesforceRelevance(`${title} ${snippet} ${cardText}`);
      const evidence = applyEvidence(root, cardText);
      const applyOnIndeed = evidence === "hosted";
      const isRemote = /\bremote\b|\bwork from home\b|\bwfh\b/i.test(
        `${locationText} ${cardText}`
      );
      const key = jobKey || link;
      found.set(key, {
        id: jobKey || key,
        title,
        company,
        location: locationText,
        remoteRestrictedTo: isRemote ? "United States" : "",
        isRemote,
        postedText,
        fromageFiltered: true,
        jdLink: link,
        jdText: snippet,
        source: "indeed",
        isIndeed: true,
        applyOnIndeed,
        indeedApplyOnSite: applyOnIndeed,
        hostedApply: applyOnIndeed,
        externalApply: evidence === "external",
        applyEvidence: evidence,
        salesforceRelevant: relevance.relevant,
        relevanceTerms: relevance.matchedTerms,
        captureEligible: relevance.relevant,
        capturedAt: new Date().toISOString(),
        status: "pending"
      });
    }
    return [...found.values()];
  }

  function scrapeCurrentDetail() {
    const detailRoot =
      document.querySelector("#jobsearch-ViewjobPaneWrapper") ||
      document.querySelector(".jobsearch-JobComponent") ||
      document.querySelector("main");
    const title = textFrom(document, [
      "h1[data-testid='jobsearch-JobInfoHeader-title']",
      "h1.jobsearch-JobInfoHeader-title",
      "h1"
    ]);
    if (!detailRoot || !title) return null;

    const company = textFrom(detailRoot, [
      "[data-testid='inlineHeader-companyName']",
      "[data-company-name='true']",
      ".jobsearch-InlineCompanyRating div:first-child"
    ]);
    const locationText = textFrom(detailRoot, [
      "[data-testid='job-location']",
      "[data-testid='inlineHeader-companyLocation']",
      ".jobsearch-JobInfoHeader-subtitle > div:last-child"
    ]);
    const description = textFrom(detailRoot, [
      "#jobDescriptionText",
      "[data-testid='jobsearch-jobDescriptionText']",
      ".jobsearch-jobDescriptionText"
    ]);
    const postedText = textFrom(detailRoot, [
      "[data-testid='myJobsStateDate']",
      "span.date",
      ".jobsearch-JobMetadataFooter"
    ]);
    const canonical = document.querySelector("link[rel='canonical']")?.href || location.href;
    const jobKey = jobKeyFrom(detailRoot, canonical);
    const relevance = salesforceRelevance(`${title} ${description}`);
    const evidence = applyEvidence(detailRoot, detailRoot.innerText);
    const applyOnIndeed = evidence === "hosted";
    const isRemote = /\bremote\b|\bwork from home\b|\bwfh\b|\btelecommut/i.test(
      `${locationText} ${description}`
    );
    return {
      id: jobKey || canonical,
      title,
      company,
      location: locationText,
      remoteRestrictedTo: isRemote ? "United States" : "",
      isRemote,
      postedText,
      fromageFiltered: true,
      jdLink: absoluteUrl(canonical),
      jdText: description,
      source: "indeed",
      isIndeed: true,
      applyOnIndeed,
      indeedApplyOnSite: applyOnIndeed,
      hostedApply: applyOnIndeed,
      externalApply: evidence === "external",
      applyEvidence: evidence,
      salesforceRelevant: relevance.relevant,
      relevanceTerms: relevance.matchedTerms,
      captureEligible: relevance.relevant,
      capturedAt: new Date().toISOString(),
      status: "pending"
    };
  }

  function jsonLdJobPosting(doc) {
    const candidates = [];
    for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const parsed = JSON.parse(script.textContent || "null");
        const walk = (value) => {
          if (!value) return;
          if (Array.isArray(value)) {
            value.forEach(walk);
            return;
          }
          if (typeof value !== "object") return;
          if (value["@type"] === "JobPosting") candidates.push(value);
          if (value["@graph"]) walk(value["@graph"]);
        };
        walk(parsed);
      } catch {
        // Ignore malformed analytics/schema blocks.
      }
    }
    return candidates[0] || null;
  }

  function htmlText(value) {
    const doc = new DOMParser().parseFromString(String(value || ""), "text/html");
    return cleanText(doc.body?.textContent);
  }

  async function fetchJobDetail(job) {
    if (!job?.jdLink) return job;
    try {
      const response = await fetch(job.jdLink, {
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "text/html,application/xhtml+xml" }
      });
      if (response.status === 429) {
        return { ...job, detailRateLimited: true };
      }
      if (!response.ok) return job;
      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      const schema = jsonLdJobPosting(doc);
      const root =
        doc.querySelector("#jobsearch-ViewjobPaneWrapper") ||
        doc.querySelector(".jobsearch-JobComponent") ||
        doc.querySelector("main") ||
        doc.body;
      const description =
        textFrom(root, [
          "#jobDescriptionText",
          "[data-testid='jobsearch-jobDescriptionText']",
          ".jobsearch-jobDescriptionText"
        ]) || htmlText(schema?.description);
      const title =
        textFrom(doc, [
          "h1[data-testid='jobsearch-JobInfoHeader-title']",
          "h1.jobsearch-JobInfoHeader-title",
          "h1"
        ]) ||
        cleanText(schema?.title) ||
        job.title;
      const company =
        textFrom(root, [
          "[data-testid='inlineHeader-companyName']",
          "[data-company-name='true']",
          ".jobsearch-InlineCompanyRating div:first-child"
        ]) ||
        cleanText(schema?.hiringOrganization?.name) ||
        job.company;
      const locationText =
        textFrom(root, [
          "[data-testid='job-location']",
          "[data-testid='inlineHeader-companyLocation']",
          ".jobsearch-JobInfoHeader-subtitle > div:last-child"
        ]) ||
        cleanText(schema?.jobLocation?.address?.addressLocality) ||
        job.location;
      const pageText = cleanText(root?.textContent);
      const evidence = applyEvidence(root, pageText);
      const applyOnIndeed = evidence === "hosted";
      const relevance = salesforceRelevance(`${title} ${description}`);
      const datePosted = cleanText(schema?.datePosted) || job.datePosted || "";
      const postedText =
        textFrom(root, ["[data-testid='myJobsStateDate']", "span.date", ".date"]) ||
        job.postedText ||
        "";
      const jobLocationType = cleanText(schema?.jobLocationType) || job.jobLocationType || "";
      const country = cleanText(
        schema?.jobLocation?.address?.addressCountry ||
          schema?.applicantLocationRequirements?.name
      );
      const isRemote =
        job.isRemote === true ||
        /telecommut/i.test(jobLocationType) ||
        /\bremote\b|\bwork from home\b|\bwfh\b/i.test(`${locationText} ${description} ${pageText}`);
      const remoteRestrictedTo =
        country && /united states|usa|\bu\.?s\.?\b/i.test(country)
          ? "United States"
          : isRemote
            ? "United States"
            : job.remoteRestrictedTo || "";
      return {
        ...job,
        title,
        company,
        location: locationText,
        remoteRestrictedTo,
        isRemote,
        jobLocationType,
        datePosted,
        postedText,
        postedAt: datePosted || job.postedAt || null,
        fromageFiltered: true,
        jdText: description || job.jdText,
        applyOnIndeed,
        indeedApplyOnSite: applyOnIndeed,
        hostedApply: applyOnIndeed,
        externalApply: evidence === "external",
        applyEvidence: evidence,
        salesforceRelevant: relevance.relevant,
        relevanceTerms: relevance.matchedTerms,
        captureEligible: relevance.relevant
      };
    } catch {
      return job;
    }
  }

  async function enrichSearchResults(results) {
    const enriched = [];
    for (const job of results) {
      if (stopped) break;
      const detail = await fetchJobDetail(job);
      enriched.push(detail);
      if (detail.detailRateLimited) break;
      await new Promise((resolve) => setTimeout(resolve, 180));
    }
    return enriched;
  }

  function nextPageUrl(resultCount) {
    const next = document.querySelector(
      "a[data-testid='pagination-page-next'][href], a[aria-label='Next Page'][href], a[aria-label='Next'][href]"
    );
    if (next?.href) return absoluteUrl(next.href);
    if (resultCount < 10 || !/\/jobs/i.test(location.pathname)) return "";
    const url = new URL(location.href);
    const current = Number(url.searchParams.get("start") || 0);
    url.searchParams.set("start", String(current + 10));
    return url.toString();
  }

  async function waitForResults() {
    const selectors =
      ".job_seen_beacon, .jobsearch-ResultsList, #jobDescriptionText, .jobsearch-JobComponent";
    if (document.querySelector(selectors)) return;
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        observer.disconnect();
        resolve();
      }, 10000);
      const observer = new MutationObserver(() => {
        if (!document.querySelector(selectors)) return;
        clearTimeout(timeout);
        observer.disconnect();
        resolve();
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    });
  }

  async function getState() {
    return (await chrome.storage.local.get(STATE_KEY))[STATE_KEY] || {};
  }

  async function saveState(state) {
    await chrome.storage.local.set({
      [STATE_KEY]: state,
      [JOBS_KEY]: Array.isArray(state.jobs) ? state.jobs : []
    });
  }

  function mergeJobs(existing, pageJobs) {
    const jobs = new Map();
    for (const job of [...(existing || []), ...(pageJobs || [])]) {
      const key = job.id || job.jdLink;
      if (!key) continue;
      jobs.set(key, { ...(jobs.get(key) || {}), ...job });
    }
    return [...jobs.values()];
  }

  async function scrapePageOnly() {
    await waitForResults();
    const gate = detectGate();
    if (gate) {
      return {
        ok: false,
        gate,
        blocked: true,
        loginRequired: gate.type === "login_required",
        captcha: gate.type === "captcha",
        rateLimited: gate.type === "rate_limited",
        error: gate.message,
        message: gate.message,
        jobs: [],
        captured: 0,
        scannedCount: 0,
        nextUrl: ""
      };
    }

    let results = scrapeSearchResults();
    results = await enrichSearchResults(results);
    if (results.some((job) => job.detailRateLimited)) {
      return {
        ok: true,
        blocked: true,
        rateLimited: true,
        message: "Indeed rate limited job-detail requests",
        jobs: results.filter((job) => job.salesforceRelevant && !job.detailRateLimited),
        allJobs: results,
        captured: results.length,
        scannedCount: results.length,
        nextUrl: ""
      };
    }
    const detail = scrapeCurrentDetail();
    if (detail) {
      const index = results.findIndex(
        (job) => job.id === detail.id || job.jdLink === detail.jdLink
      );
      if (index >= 0) results[index] = { ...results[index], ...detail };
      else results.push(detail);
    }
    return {
      ok: true,
      // Keep every Salesforce-related listing in the queue. The service worker
      // separately gates full submission to explicit Apply-on-Indeed jobs.
      jobs: results.filter((job) => job.salesforceRelevant),
      allJobs: results,
      captured: results.length,
      scannedCount: results.length,
      nextUrl: nextPageUrl(results.length)
    };
  }

  async function processCurrentPage() {
    if (processing || stopped) return { ok: false, error: "Capture is not active." };
    processing = true;
    try {
      const state = await getState();
      if (state.status !== "running") return { ok: false, status: state.status || "idle" };
      const page = Math.max(1, Number(state.page || 1));
      const maxPages = Math.max(1, Number(state.maxPages || 1));
      await saveState({ ...state, page, message: "Scanning Indeed results" });

      const pageResult = await scrapePageOnly();
      if (!pageResult.ok && pageResult.gate) {
        const blocked = {
          ...state,
          status: "blocked",
          page,
          blockReason: pageResult.gate.type,
          message: pageResult.gate.message,
          updatedAt: Date.now()
        };
        await saveState(blocked);
        return { ok: false, state: blocked };
      }

      const jobs = mergeJobs(state.jobs, pageResult.jobs);
      const scannedCount = Number(state.scannedCount || 0) + pageResult.scannedCount;
      const base = {
        ...state,
        page,
        jobs,
        capturedCount: jobs.length,
        scannedCount,
        lastPageUrl: location.href,
        updatedAt: Date.now()
      };

      const latest = await getState();
      if (stopped || latest.status !== "running") {
        const stoppedState = {
          ...base,
          status: "stopped",
          message: "Stopped by user",
          stoppedAt: Date.now()
        };
        await saveState(stoppedState);
        return { ok: true, state: stoppedState };
      }

      if (page >= maxPages || !pageResult.nextUrl) {
        const complete = {
          ...base,
          status: "complete",
          message: !pageResult.nextUrl ? "No next results page" : "Maximum pages reached",
          completedAt: Date.now()
        };
        await saveState(complete);
        return { ok: true, state: complete, pageResult };
      }

      const advancing = {
        ...base,
        page: page + 1,
        nextUrl: pageResult.nextUrl,
        message: `Advancing to page ${page + 1}`
      };
      await saveState(advancing);
      setTimeout(() => {
        if (!stopped) location.assign(pageResult.nextUrl);
      }, 700);
      return { ok: true, state: advancing, pageResult };
    } catch (error) {
      const state = await getState().catch(() => ({}));
      const failed = {
        ...state,
        status: "error",
        message: String(error?.message || error),
        updatedAt: Date.now()
      };
      await saveState(failed).catch(() => {});
      return { ok: false, error: failed.message, state: failed };
    } finally {
      processing = false;
    }
  }

  async function startCapture(message) {
    stopped = false;
    const maxPages = Math.min(50, Math.max(1, Number(message.maxPages || 5)));
    const target = absoluteUrl(message.searchUrl || location.href);
    const state = {
      status: "running",
      searchUrl: target,
      query: cleanText(message.query),
      maxPages,
      page: 1,
      scannedCount: 0,
      capturedCount: 0,
      jobs: [],
      startedAt: Date.now(),
      message: "Starting Indeed capture"
    };
    await saveState(state);
    if (target && target !== location.href) {
      location.assign(target);
      return { ok: true, navigating: true, state };
    }
    return processCurrentPage();
  }

  async function stopCapture() {
    stopped = true;
    const state = await getState();
    const stoppedState = {
      ...state,
      status: "stopped",
      message: "Stopped by user",
      stoppedAt: Date.now()
    };
    await saveState(stoppedState);
    return { ok: true, state: stoppedState };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message.type !== "string") return undefined;

    if (message.type === "indeed_capture_start") {
      startCapture(message).then(sendResponse);
      return true;
    }
    if (message.type === "indeed_capture_stop") {
      stopCapture().then(sendResponse);
      return true;
    }
    if (message.type === "indeed_capture_scrape_page") {
      scrapePageOnly().then((result) => sendResponse({ ok: result.ok, ...result }));
      return true;
    }
    if (message.type === "indeed_capture_scan_page") {
      scrapePageOnly().then((result) => sendResponse({ ok: result.ok, ...result }));
      return true;
    }
    if (message.type === "indeed_capture_next_page") {
      getState().then(async (state) => {
        const target = absoluteUrl(message.url || state.nextUrl);
        if (!target) {
          sendResponse({ ok: false, error: "No next Indeed page URL." });
          return;
        }
        await saveState({
          ...state,
          status: "running",
          page: Number(message.page || state.page || 1),
          nextUrl: target,
          message: "Navigating to next Indeed page"
        });
        sendResponse({ ok: true, navigating: true, url: target });
        location.assign(target);
      });
      return true;
    }
    if (message.type === "indeed_capture_status") {
      getState().then((state) => sendResponse({ ok: true, state }));
      return true;
    }
    return undefined;
  });

})();
