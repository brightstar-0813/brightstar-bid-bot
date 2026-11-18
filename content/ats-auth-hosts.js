/**
 * Employer ATS sign-in / sign-up hosts where the bot may fill the person's saved
 * ATS credentials (email + per-person ATS password) — user decision Q35, 2026-11-18.
 *
 * Job boards and aggregators (Himalayas, Jobgether, Built In, LinkedIn, Indeed,
 * Dice, Jobright, Glassdoor, ZipRecruiter, …) are never on this list: a sign-in
 * form there stays a blocker for the user.
 *
 * Attaches to globalThis.BrightstarAtsAuthHosts for content/autofill.js.
 */
(() => {
  "use strict";

  // Host suffixes of employer applicant-tracking systems (account per employer tenant).
  const EMPLOYER_ATS_AUTH_SUFFIXES = [
    "ultipro.com", // UKG: recruiting.ultipro.com, signin-us.ultipro.com
    "ukg.com",
    "icims.com",
    "taleo.net",
    "successfactors.com",
    "successfactors.eu",
    "sapsf.com",
    "oraclecloud.com", // Oracle HCM candidate experience
    "myworkdayjobs.com",
    "workdayjobs.com",
    "jobvite.com",
    "smartrecruiters.com",
    "brassring.com",
    "avature.net",
    "paylocity.com",
    "adp.com" // workforcenow.adp.com career center
  ];

  // Never fill credentials here, even if a suffix above would match.
  const NEVER_SUFFIXES = [
    "himalayas.app",
    "jobgether.com",
    "builtin.com",
    "linkedin.com",
    "indeed.com",
    "dice.com",
    "jobright.ai",
    "glassdoor.com",
    "ziprecruiter.com",
    "monster.com",
    "google.com",
    "microsoft.com",
    "live.com",
    "outlook.com"
  ];

  function hostMatches(host, suffix) {
    return host === suffix || host.endsWith(`.${suffix}`);
  }

  function isEmployerAtsAuthHost(hostname) {
    const host = String(hostname || "").trim().toLowerCase().replace(/\.$/, "");
    if (!host) return false;
    if (NEVER_SUFFIXES.some((s) => hostMatches(host, s))) return false;
    return EMPLOYER_ATS_AUTH_SUFFIXES.some((s) => hostMatches(host, s));
  }

  globalThis.BrightstarAtsAuthHosts = {
    EMPLOYER_ATS_AUTH_SUFFIXES,
    NEVER_SUFFIXES,
    isEmployerAtsAuthHost
  };
})();
