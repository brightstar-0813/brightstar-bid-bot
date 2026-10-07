/**
 * Hiring-focused roles + human cover-letter-style email templates.
 * Short closing greeting only (Warm regards / Thank you) — no name/phone block.
 * ~10 style variants per role / reply purpose; pickRotatingVariant skips recent voices.
 */

/** @typedef {"recruiter"|"hr"|"cto"|"hiring_manager"|"team_lead"|"unknown"} ContactRoleKind */

/**
 * @typedef {{ styleId?: string, subject: string, body: string }} EmailVariant
 * @typedef {{ id: number, name: string, bestFor: string, variants: EmailVariant[] }} EmailTemplateFamily
 * @typedef {{ id: string, name: string, variants: EmailVariant[] }} ReplyTemplateFamily
 */

export const EMAIL_STYLE_RECENT_KEY = "email_style_recent";

/** @param {string} seed */
export function hashSeed(seed) {
  let h = 0;
  const s = String(seed || "");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * Prefer the next style after the last used one; skip the last two recent ids.
 * @param {EmailVariant[]} variants
 * @param {{ seed?: string, recentIds?: string[] }} [opts]
 */
export function pickRotatingVariant(variants, { seed = "", recentIds = [] } = {}) {
  const list = Array.isArray(variants) ? variants : [];
  if (!list.length) {
    return {
      subject: "Application",
      body: "Hi,\n\nPlease find my resume attached.",
      styleId: "fallback",
      styleIndex: 0
    };
  }
  const recent = (Array.isArray(recentIds) ? recentIds : []).map(String).filter(Boolean).slice(0, 2);
  const n = list.length;
  const start = hashSeed(seed) % n;
  let preferStart = start;
  if (recent.length) {
    const lastId = recent[0];
    const lastIdx = list.findIndex((v, i) => String(v.styleId || v.id || i) === lastId);
    if (lastIdx >= 0) preferStart = (lastIdx + 1) % n;
  }
  for (let i = 0; i < n; i += 1) {
    const idx = (preferStart + i) % n;
    const v = list[idx];
    const id = String(v.styleId || v.id || idx);
    if (!recent.includes(id)) {
      return { subject: v.subject, body: v.body, styleId: id, styleIndex: idx };
    }
  }
  const v = list[preferStart];
  return {
    subject: v.subject,
    body: v.body,
    styleId: String(v.styleId || v.id || preferStart),
    styleIndex: preferStart
  };
}

/** @param {string[]} recentIds @param {string} styleId @param {number} [max] */
export function pushRecentStyleId(recentIds, styleId, max = 2) {
  const id = String(styleId || "").trim();
  if (!id) return (Array.isArray(recentIds) ? recentIds : []).map(String).slice(0, max);
  return [id, ...(Array.isArray(recentIds) ? recentIds : []).map(String).filter((x) => x !== id)].slice(
    0,
    max
  );
}

export async function loadRecentEmailStyles() {
  try {
    if (typeof chrome === "undefined" || !chrome.storage?.local?.get) return [];
    const data = await chrome.storage.local.get(EMAIL_STYLE_RECENT_KEY);
    return Array.isArray(data[EMAIL_STYLE_RECENT_KEY]) ? data[EMAIL_STYLE_RECENT_KEY].map(String) : [];
  } catch {
    return [];
  }
}

export async function rememberEmailStyle(styleId) {
  const recent = await loadRecentEmailStyles();
  const next = pushRecentStyleId(recent, styleId);
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local?.set) {
      await chrome.storage.local.set({ [EMAIL_STYLE_RECENT_KEY]: next });
    }
  } catch {
    /* ignore */
  }
  return next;
}

function withStyleIds(variants, prefix) {
  return (variants || []).map((v, i) => ({
    ...v,
    styleId: v.styleId || `${prefix}-${i}`
  }));
}

/** @type {Record<number, EmailTemplateFamily>} */
export const EMAIL_TEMPLATES = {
  1: {
    id: 1,
    name: "Recruiter / TA",
    bestFor: "Recruiters and talent acquisition",
    variants: withStyleIds(
      [
        {
          subject: "[Role Title] — [Your Name] (resume attached)",
          body: `Hi [Name],

I saw the [Role Title] opening at [Company] and wanted to reach out directly rather than only applying through the portal.

I've spent [number] years in [professional area], most recently deep in [skill 1] and [skill 2]. The JD's focus on [key requirement] matches work I've already done — for example, [short example showing ownership and impact].

Happy to jump on a quick call if useful. Resume is attached.

Warm regards,`
        },
        {
          subject: "Quick note on the [Role Title] role at [Company]",
          body: `Hello [Name],

Thanks for the time if this lands mid-screen. Hoping to connect about the [Role Title] seat.

My background is [professional area] ([number]+ years), with day-to-day strength in [skill 1], [skill 2], and [skill 3]. What stood out was [specific reason].

Resume attached if useful.

Thank you,`
        },
        {
          subject: "[Your Name] for [Role Title] @ [Company]",
          body: `Hi [Name],

Applying for [Role Title] — short note below, resume attached.

At [current or recent company], I [brief technical achievement with an outcome]. That lines up with [key requirement] and [requirement 2].

If a better fit is on your reqs list, I'm open to that too.

Best regards,`
        },
        {
          subject: "[Company] [Role Title] — interest",
          body: `Hi [Name],

I'm interested in [Role Title] at [Company].

[number]+ years in [professional area]; recent focus on [skill 1] / [skill 2]. Example: [short example showing ownership and impact].

Resume attached.

Appreciate it,`
        },
        {
          subject: "Is the [Role Title] still open?",
          body: `Hi [Name],

Is the [Role Title] role at [Company] still open? If so, I'd like to be considered.

I bring [number] years in [professional area], especially [skill 1] and [skill 2]. Resume attached.

Thanks,`
        },
        {
          subject: "[Role Title] — availability this week",
          body: `Hi [Name],

Reaching out on the [Role Title] opening at [Company].

- [number]+ years in [professional area]
- Strengths: [skill 1], [skill 2], [skill 3]
- Recent: [short example showing ownership and impact]

Resume attached. Glad to chat this week if useful.

Thank you,`
        },
        {
          subject: "Application: [Role Title] at [Company]",
          body: `Dear [Name],

Please find my resume for the [Role Title] position at [Company].

I have [number] years of experience in [professional area], with particular strength in [skill 1] and [key requirement]. Recently at [current or recent company], I [relevant responsibility or achievement].

I would welcome a brief conversation at your convenience.

Sincerely,`
        },
        {
          subject: "Hey — [Role Title] at [Company]",
          body: `Hey [Name],

Saw the [Role Title] posting and figured a short note beats another portal form.

I've been doing [professional area] for [number]+ years — lately [skill 1] and [skill 2]. Resume's attached if you want the detail.

Thanks,`
        },
        {
          subject: "Resume for [Role Title] — [Your Name]",
          body: `Hi [Name],

Resume attached for the [Role Title] role at [Company].

Highlights: [skill 1], [skill 2], and [short example showing ownership and impact]. Happy to expand on anything in a quick call.

Warm regards,`
        },
        {
          subject: "Next step on [Role Title]?",
          body: `Hi [Name],

I'd like to take a next step on the [Role Title] role at [Company].

My background maps to [key requirement] through [skill 1] / [skill 2] work ([number]+ years). Resume attached — what's the best way to proceed on your side?

Best regards,`
        }
      ],
      "cold-recruiter"
    )
  },
  2: {
    id: 2,
    name: "HR focused",
    bestFor: "HR and people operations",
    variants: withStyleIds(
      [
        {
          subject: "Interest in [Role Title] at [Company]",
          body: `Hi [Name],

I'm interested in the [Role Title] position at [Company] and wanted to introduce myself briefly.

My path has been [specialty or industry], especially [two relevant skills]. Recently at [current or recent company], I [relevant responsibility or achievement].

I've attached my resume and would welcome a short conversation if the timing is right.

Warm regards,`
        },
        {
          subject: "[Role Title] application — [Your Name]",
          body: `Hello [Name],

Sharing my resume for the [Role Title] opening.

What drew me in was [specific reason], plus the need for [key requirement] — both show up in my recent work with [skill 1] and [skill 2].

Happy to answer screening questions.

Thank you,`
        },
        {
          subject: "[Your Name] — [Role Title]",
          body: `Hi [Name],

Applying for [Role Title] at [Company]. Resume attached.

[number]+ years in [specialty or industry]; recent focus on [skill 1] and [skill 2].

Best regards,`
        },
        {
          subject: "[Company] [Role Title]",
          body: `Hi [Name],

Interested in [Role Title]. Background: [specialty or industry], [two relevant skills]. At [current or recent company], I [relevant responsibility or achievement].

Resume attached.

Appreciate it,`
        },
        {
          subject: "Quick question on [Role Title]",
          body: `Hi [Name],

Is [Role Title] at [Company] still accepting candidates? If yes, please find my resume attached.

I bring experience in [specialty or industry] with [skill 1] and [skill 2].

Thanks,`
        },
        {
          subject: "[Role Title] — brief intro",
          body: `Hi [Name],

Brief intro for [Role Title]:

- [specialty or industry]
- [skill 1] / [skill 2]
- Recent: [relevant responsibility or achievement]

Resume attached.

Thank you,`
        },
        {
          subject: "Formal application — [Role Title]",
          body: `Dear [Name],

I am writing to apply for the [Role Title] role at [Company]. Please find my resume enclosed.

My experience centers on [specialty or industry] and [key requirement], most recently at [current or recent company].

I look forward to hearing from you.

Sincerely,`
        },
        {
          subject: "Hi — applying for [Role Title]",
          body: `Hey [Name],

Putting my name in for [Role Title] at [Company]. Resume attached.

I've been in [specialty or industry] with solid [skill 1] / [skill 2] work. Happy to chat if helpful.

Thanks,`
        },
        {
          subject: "Resume attached — [Role Title]",
          body: `Hi [Name],

Resume attached for [Role Title] at [Company]. Glad to fill in any screening details you need.

Warm regards,`
        },
        {
          subject: "How should I proceed on [Role Title]?",
          body: `Hi [Name],

I'd like to move forward on [Role Title] at [Company]. Resume is attached — what is the next step on your process?

Best regards,`
        }
      ],
      "cold-hr"
    )
  },
  3: {
    id: 3,
    name: "CTO / technical leader",
    bestFor: "CTO, VP Engineering, technical director",
    variants: withStyleIds(
      [
        {
          subject: "[Technical Title] interested in [Company]'s [Role Title]",
          body: `Hi [Name],

I'm reaching out about the [Role Title] role — less as a generic application, more because the technical shape of it fits how I work.

I've spent [number] years building and supporting [platforms, applications, or systems], with a core stack around [skill 1], [skill 2], and [skill 3]. Recently I [brief technical achievement with an outcome].

The posting's emphasis on [specific requirement] is the kind of problem I like owning. Resume attached.

Best regards,`
        },
        {
          subject: "Re: [Role Title] — hands-on [Key Skill] background",
          body: `Hello [Name],

Quick note on the [Role Title] opening at [Company].

I'm a [Technical Title] with [number] years in the weeds on [skill 1] / [skill 2]. One recent example: [short example showing ownership and impact].

If your team is prioritizing [key requirement], I'd like to talk. Resume is attached.

Warm regards,`
        },
        {
          subject: "[Role Title] at [Company] — technical fit",
          body: `Hi [Name],

Technical fit note on [Role Title]: [skill 1], [skill 2], [number]+ years. Recent outcome: [brief technical achievement with an outcome].

Resume attached.

Thank you,`
        },
        {
          subject: "[Company] eng — [Role Title]",
          body: `Hi [Name],

Interested in [Role Title]. Stack focus: [skill 1] / [skill 2] / [skill 3]. Example ownership: [short example showing ownership and impact].

Resume attached.

Appreciate it,`
        },
        {
          subject: "Worth a quick technical chat on [Role Title]?",
          body: `Hi [Name],

Worth a short chat on [Role Title]? I can walk through how I've handled [key requirement] with [skill 1].

Resume attached.

Thanks,`
        },
        {
          subject: "[Role Title] — skills snapshot",
          body: `Hi [Name],

Snapshot for [Role Title]:

- [Technical Title], [number]+ years
- [skill 1], [skill 2], [skill 3]
- Recent: [brief technical achievement with an outcome]

Resume attached.

Best regards,`
        },
        {
          subject: "Application for [Role Title] — [Your Name]",
          body: `Dear [Name],

Please consider my application for [Role Title] at [Company]. Resume enclosed.

I have [number] years building [platforms, applications, or systems], with depth in [skill 1] and [specific requirement].

Sincerely,`
        },
        {
          subject: "Quick tech note — [Role Title]",
          body: `Hey [Name],

Saw [Role Title] and figured I'd skip the long cover letter. Hands-on [skill 1] / [skill 2] for [number]+ years. Resume attached if you want more.

Thanks,`
        },
        {
          subject: "Resume — [Role Title] / [Key Skill]",
          body: `Hi [Name],

Resume attached for [Role Title], with emphasis on [Key Skill] and [key requirement].

Warm regards,`
        },
        {
          subject: "Next conversation on [Role Title]?",
          body: `Hi [Name],

I'd welcome a technical conversation on [Role Title] at [Company]. Resume attached — happy to go deeper on [specific requirement] whenever works.

Best regards,`
        }
      ],
      "cold-cto"
    )
  },
  4: {
    id: 4,
    name: "Hiring manager",
    bestFor: "Manager responsible for the open role",
    variants: withStyleIds(
      [
        {
          subject: "[Role Title] — experience with [Key Skill]",
          body: `Hi [Name],

I'm interested in joining your team as a [Role Title].

The posting calls out [requirement 1] and [requirement 2], which have been central in my recent work. At [company], I [relevant responsibility], including [specific task or result].

Resume attached — happy to walk through how I'd approach the first 90 days if useful.

Thank you,`
        },
        {
          subject: "Applying for your [Role Title] role",
          body: `Hello [Name],

Saw the [Role Title] opening and wanted a bit more context than the portal form allows.

I've been doing [professional area] for [number] years, with recent focus on [skill 1] and [skill 2]. A concrete example: [short example showing ownership and impact].

Resume is attached.

Best regards,`
        },
        {
          subject: "[Your Name] — [Role Title] on your team",
          body: `Hi [Name],

Interested in [Role Title] on your team. [number]+ years in [professional area]; recent work in [skill 1] / [skill 2].

Resume attached.

Warm regards,`
        },
        {
          subject: "[Role Title] interest",
          body: `Hi [Name],

Interested in your [Role Title] opening. At [company], I [relevant responsibility]. Resume attached.

Appreciate it,`
        },
        {
          subject: "Would you take a look at my resume for [Role Title]?",
          body: `Hi [Name],

Would you take a look at my resume for [Role Title]? Happy to discuss how I'd support [requirement 1] and [requirement 2].

Thanks,`
        },
        {
          subject: "[Role Title] — fit notes",
          body: `Hi [Name],

Fit notes for [Role Title]:

- [professional area], [number]+ years
- [skill 1] / [skill 2]
- Example: [short example showing ownership and impact]

Resume attached.

Thank you,`
        },
        {
          subject: "Application for [Role Title]",
          body: `Dear [Name],

Please accept my application for [Role Title]. Resume enclosed.

My experience includes [requirement 1] and [requirement 2], most recently at [company].

Sincerely,`
        },
        {
          subject: "Hi — [Role Title] on your team",
          body: `Hey [Name],

Putting myself forward for [Role Title]. Resume attached. Happy to talk priorities on your team anytime.

Thanks,`
        },
        {
          subject: "Resume for your [Role Title] opening",
          body: `Hi [Name],

Resume attached for your [Role Title] opening. Glad to expand on anything that matters for the first 90 days.

Warm regards,`
        },
        {
          subject: "Open to a short intro call on [Role Title]?",
          body: `Hi [Name],

Open to a short intro call on [Role Title]? Resume is attached so you have context first.

Best regards,`
        }
      ],
      "cold-hm"
    )
  },
  5: {
    id: 5,
    name: "Team lead",
    bestFor: "Team lead or delivery lead",
    variants: withStyleIds(
      [
        {
          subject: "Interested in the [Role Title] on your team",
          body: `Hi [Name],

I'm interested in the [Role Title] opportunity on your team.

My background is [number] years in [field], focused on [specialty]. One strength I'd bring is [specific strength] — for example, I recently [short example showing ownership and impact].

Resume attached. Glad to chat about current priorities if you're open to it.

Warm regards,`
        },
        {
          subject: "[Your Name] — [Role Title] (resume)",
          body: `Hello [Name],

Reaching out about the [Role Title] role.

What caught my eye was [specific reason], especially the need for [key requirement]. That's close to work I just finished around [skill 1] / [skill 2].

I've attached my resume.

Thanks,`
        },
        {
          subject: "[Role Title] on your team",
          body: `Hi [Name],

Interested in [Role Title] on your team. [number]+ years in [field]; strength in [specific strength].

Resume attached.

Best regards,`
        },
        {
          subject: "[Company] [Role Title]",
          body: `Hi [Name],

Quick interest note on [Role Title]: [skill 1] / [skill 2], recent [short example showing ownership and impact]. Resume attached.

Appreciate it,`
        },
        {
          subject: "Still hiring for [Role Title]?",
          body: `Hi [Name],

Still hiring for [Role Title]? If so, resume attached — happy to compare notes on how your team ships.

Thanks,`
        },
        {
          subject: "[Role Title] — delivery snapshot",
          body: `Hi [Name],

Delivery snapshot for [Role Title]:

- [field], [number]+ years
- [specialty] / [specific strength]
- Recent: [short example showing ownership and impact]

Resume attached.

Thank you,`
        },
        {
          subject: "Application — [Role Title]",
          body: `Dear [Name],

Please consider my application for [Role Title]. Resume enclosed.

I have [number] years in [field], with focus on [specialty] and [key requirement].

Sincerely,`
        },
        {
          subject: "Hey — [Role Title] on your squad",
          body: `Hey [Name],

Interested in [Role Title] on your squad. Resume attached. Would love to hear what you're optimizing for right now.

Thanks,`
        },
        {
          subject: "Resume — [Role Title]",
          body: `Hi [Name],

Resume attached for [Role Title]. Happy to dig into delivery practices whenever useful.

Warm regards,`
        },
        {
          subject: "Can we compare notes on [Role Title]?",
          body: `Hi [Name],

Can we compare notes on [Role Title]? Resume is attached so you have background first.

Best regards,`
        }
      ],
      "cold-lead"
    )
  }
};

/**
 * @param {string} role
 * @returns {ContactRoleKind}
 */
export function classifyContactRole(role) {
  const r = String(role || "").toLowerCase();
  if (/\brecruit|\btalent\b|\bta\b|\bstaffer|\bsourcing\b/.test(r)) return "recruiter";
  if (/\bhr\b|\bhuman resources|\bpeople ops|\bpeople partner|\bpeople operations/.test(r)) {
    return "hr";
  }
  if (/\bcto\b|\bchief technology|\bvp\s*eng|\bvice president.*eng|\bhead of eng|\bengineering director/.test(r)) {
    return "cto";
  }
  if (/\blead\b|\bteam lead|\btech lead|\bengineering manager|\bdelivery manager/.test(r)) {
    return "team_lead";
  }
  if (/\bhiring manager|\bmanager\b|\bdirector\b|\bhead of\b/.test(r)) return "hiring_manager";
  return "unknown";
}

/**
 * Prefer hiring-related contacts over executives.
 * @param {Array<object>} contacts
 */
export function pickPrimaryContact(contacts) {
  const list = Array.isArray(contacts) ? contacts : [];
  const rank = (c) => {
    const kind = classifyContactRole(c?.role);
    const order = { recruiter: 0, hr: 1, hiring_manager: 2, team_lead: 3, cto: 4, unknown: 5 };
    return (order[kind] ?? 5) - Number(c?.confidence || 0) * 0.1;
  };
  return [...list].sort((a, b) => rank(a) - rank(b))[0] || null;
}

/**
 * @param {ContactRoleKind|string} kind
 */
export function selectTemplateForRole(kind) {
  const k = String(kind || "");
  if (k === "recruiter") return EMAIL_TEMPLATES[1];
  if (k === "hr") return EMAIL_TEMPLATES[2];
  if (k === "cto") return EMAIL_TEMPLATES[3];
  if (k === "hiring_manager") return EMAIL_TEMPLATES[4];
  if (k === "team_lead") return EMAIL_TEMPLATES[5];
  return EMAIL_TEMPLATES[1];
}

/** Replies to mail that already arrived. Cold-intro families stay above. */
/** @type {ReplyTemplateFamily[]} */
export const REPLY_TEMPLATES = [
  {
    id: "rate",
    name: "Rate confirmation",
    variants: withStyleIds(
      [
        {
          subject: "Re: [Role Title] — rate confirmation",
          body: `Hi [Name],

Confirming the pay rate we discussed for the [Role Title] role at [Company]: [Rate].

I'm available to start [Start date] and can complete any remaining paperwork.

Thank you,`
        },
        {
          subject: "Thanks — confirming rate for [Role Title]",
          body: `Hello [Name],

Thanks for following up. Confirming rate for [Role Title] at [Company]: [Rate].

Start date that works: [Start date]. Happy to finish paperwork next.

Warm regards,`
        },
        {
          subject: "Rate: [Rate]",
          body: `Hi [Name],

Confirmed: [Rate] for [Role Title] at [Company].

Available [Start date].

Best regards,`
        },
        {
          subject: "Re: [Role Title]",
          body: `Hi [Name],

Appreciate the note. Yes — confirming [Rate] for the [Role Title] role at [Company].

I can start [Start date] and handle remaining forms promptly.

Appreciate it,`
        },
        {
          subject: "Quick confirm on rate?",
          body: `Hi [Name],

Can you confirm we're aligned on [Rate] for [Role Title] at [Company]? That's what I have from our last note.

If yes, I can start [Start date].

Thanks,`
        },
        {
          subject: "Re: rate / start — [Role Title]",
          body: `Hi [Name],

Confirming:

- Role: [Role Title] at [Company]
- Rate: [Rate]
- Start: [Start date]

Ready for paperwork whenever you are.

Thank you,`
        },
        {
          subject: "Confirmation of compensation — [Role Title]",
          body: `Dear [Name],

This confirms the compensation discussed for [Role Title] at [Company]: [Rate].

I remain available to commence on [Start date] and to complete any outstanding documentation.

Sincerely,`
        },
        {
          subject: "Yep — [Rate] works",
          body: `Hey [Name],

Yep — [Rate] works for [Role Title] at [Company]. I can start [Start date].

Thanks,`
        },
        {
          subject: "Re: [Role Title] — paperwork ready",
          body: `Hi [Name],

Confirming [Rate] for [Role Title] at [Company]. Resume already on file if you need it again; I can start [Start date] and finish paperwork ASAP.

Warm regards,`
        },
        {
          subject: "Next step after rate confirm?",
          body: `Hi [Name],

Confirming [Rate] for [Role Title] at [Company], start [Start date]. What's the next step on your side?

Best regards,`
        }
      ],
      "reply-rate"
    )
  },
  {
    id: "update",
    name: "Still interested",
    variants: withStyleIds(
      [
        {
          subject: "Re: [Role Title] at [Company]",
          body: `Hi [Name],

Thanks for checking in. I'm still interested in the [Role Title] role at [Company] and available to move forward.

Please tell me the next step.

Thank you,`
        },
        {
          subject: "Still interested — [Role Title]",
          body: `Hello [Name],

Thanks for the nudge. Still very interested in [Role Title] at [Company].

Happy to jump on a call or complete anything outstanding.

Warm regards,`
        },
        {
          subject: "Re: [Role Title]",
          body: `Hi [Name],

Still interested. Available to proceed on [Role Title] at [Company].

Best regards,`
        },
        {
          subject: "Following up on [Role Title]",
          body: `Hi [Name],

Following up gently — I remain interested in [Role Title] at [Company] and can move quickly when you are ready.

Appreciate it,`
        },
        {
          subject: "Any update on [Role Title]?",
          body: `Hi [Name],

Any update on [Role Title] at [Company]? I'm still interested and flexible on next steps.

Thanks,`
        },
        {
          subject: "Re: status — [Role Title]",
          body: `Hi [Name],

Status on my side:

- Still interested in [Role Title] at [Company]
- Ready for interviews / paperwork

What should I expect next?

Thank you,`
        },
        {
          subject: "Continued interest — [Role Title]",
          body: `Dear [Name],

I am writing to reaffirm my interest in the [Role Title] position at [Company] and to inquire about the current status of the process.

Sincerely,`
        },
        {
          subject: "Still in — [Role Title]",
          body: `Hey [Name],

Still in on [Role Title] at [Company]. Ping me whenever you have an update.

Thanks,`
        },
        {
          subject: "Re: [Role Title] — resume on hand if needed",
          body: `Hi [Name],

Still interested in [Role Title] at [Company]. I can resend the resume if helpful — just say the word.

Warm regards,`
        },
        {
          subject: "Ready for the next step on [Role Title]",
          body: `Hi [Name],

Ready for the next step on [Role Title] at [Company] whenever you are. What do you need from me?

Best regards,`
        }
      ],
      "reply-update"
    )
  },
  {
    id: "availability",
    name: "Availability",
    variants: withStyleIds(
      [
        {
          subject: "Re: [Role Title] — availability",
          body: `Hi [Name],

I'm available to talk about the [Role Title] role at [Company].

Times that work: [Times].

Thank you,`
        },
        {
          subject: "Thanks — here's my availability",
          body: `Hello [Name],

Thanks for reaching out on [Role Title] at [Company]. Here's my availability:

[Times]

Warm regards,`
        },
        {
          subject: "Availability: [Times]",
          body: `Hi [Name],

Available: [Times] for [Role Title] / [Company].

Best regards,`
        },
        {
          subject: "Re: [Role Title] call",
          body: `Hi [Name],

Happy to make time for [Role Title] at [Company]. Slots that work best: [Times]. If none fit, suggest alternatives and I'll match.

Appreciate it,`
        },
        {
          subject: "When works for a quick call?",
          body: `Hi [Name],

When works for a quick call on [Role Title] at [Company]? I'm free [Times].

Thanks,`
        },
        {
          subject: "Re: interview windows — [Role Title]",
          body: `Hi [Name],

Interview windows for [Role Title] at [Company]:

- [Times]

Confirm whichever is easiest on your calendar.

Thank you,`
        },
        {
          subject: "Availability for discussion — [Role Title]",
          body: `Dear [Name],

I am available to discuss the [Role Title] opportunity at [Company] at the following times: [Times].

Please advise which is most convenient.

Sincerely,`
        },
        {
          subject: "Free [Times]",
          body: `Hey [Name],

Free [Times] to talk [Role Title] at [Company]. Text me know what sticks.

Thanks,`
        },
        {
          subject: "Re: [Role Title] — calendar + resume ready",
          body: `Hi [Name],

Calendar open [Times] for [Role Title] at [Company]. Resume is ready if you need it ahead of the call.

Warm regards,`
        },
        {
          subject: "Book me for [Role Title]?",
          body: `Hi [Name],

Please book me for [Role Title] at [Company] in one of these windows: [Times]. If another time is better, send it over.

Best regards,`
        }
      ],
      "reply-availability"
    )
  },
  {
    id: "thanks",
    name: "Thanks, resume attached",
    variants: withStyleIds(
      [
        {
          subject: "Re: [Role Title] — resume attached",
          body: `Hi [Name],

Thank you for reaching out about the [Role Title] role at [Company]. My resume is attached.

Happy to answer any questions.

Thank you,`
        },
        {
          subject: "Thanks — resume for [Role Title]",
          body: `Hello [Name],

Thanks for thinking of me for [Role Title] at [Company]. Resume attached — glad to fill in anything else you need.

Warm regards,`
        },
        {
          subject: "Resume attached",
          body: `Hi [Name],

Resume attached for [Role Title] at [Company].

Best regards,`
        },
        {
          subject: "Re: [Role Title]",
          body: `Hi [Name],

Appreciate you reaching out. Resume for [Role Title] at [Company] is attached.

Appreciate it,`
        },
        {
          subject: "Got your note — resume enclosed",
          body: `Hi [Name],

Got your note on [Role Title] at [Company]. Resume enclosed — any screening questions?

Thanks,`
        },
        {
          subject: "Re: [Role Title] materials",
          body: `Hi [Name],

Materials for [Role Title] at [Company]:

- Resume attached

Happy to add anything else.

Thank you,`
        },
        {
          subject: "Resume for [Role Title] — [Your Name]",
          body: `Dear [Name],

Thank you for contacting me regarding [Role Title] at [Company]. Please find my resume attached for your review.

Sincerely,`
        },
        {
          subject: "Thanks — resume's on this note",
          body: `Hey [Name],

Thanks for the ping on [Role Title] at [Company]. Resume's attached.

Thanks,`
        },
        {
          subject: "Re: [Role Title] — resume + happy to talk",
          body: `Hi [Name],

Resume attached for [Role Title] at [Company]. Happy to hop on a short call if useful.

Warm regards,`
        },
        {
          subject: "Next step after you review the resume?",
          body: `Hi [Name],

Resume attached for [Role Title] at [Company]. What's the next step once you've had a look?

Best regards,`
        }
      ],
      "reply-thanks"
    )
  },
  {
    id: "decline",
    name: "Not moving forward",
    variants: withStyleIds(
      [
        {
          subject: "Re: [Role Title]",
          body: `Hi [Name],

Thank you for thinking of me for the [Role Title] role at [Company]. I'm going to pass on this one.

I appreciate the note.

Best regards,`
        },
        {
          subject: "Thanks — stepping back from [Role Title]",
          body: `Hello [Name],

Thanks for reaching out on [Role Title] at [Company]. I'm going to step back from this opportunity.

Warm regards,`
        },
        {
          subject: "Passing on [Role Title]",
          body: `Hi [Name],

Passing on [Role Title] at [Company]. Thanks for considering me.

Thank you,`
        },
        {
          subject: "Re: [Role Title] at [Company]",
          body: `Hi [Name],

Appreciate you thinking of me. I'll pass on [Role Title] at [Company] this time — please keep me in mind for a closer fit later if that helps.

Appreciate it,`
        },
        {
          subject: "Can we pause on [Role Title]?",
          body: `Hi [Name],

Can we pause on [Role Title] at [Company]? It's not the right move for me right now. Thanks for understanding.

Thanks,`
        },
        {
          subject: "Re: decision — [Role Title]",
          body: `Hi [Name],

Decision on [Role Title] at [Company]: I will not be moving forward.

Thank you again for the outreach.

Thank you,`
        },
        {
          subject: "Declining [Role Title]",
          body: `Dear [Name],

Thank you for considering me for [Role Title] at [Company]. I must decline at this time.

Sincerely,`
        },
        {
          subject: "Gonna pass — [Role Title]",
          body: `Hey [Name],

Gonna pass on [Role Title] at [Company]. Thanks for reaching out anyway.

Thanks,`
        },
        {
          subject: "Re: [Role Title] — not proceeding",
          body: `Hi [Name],

Not proceeding on [Role Title] at [Company]. Grateful you thought of me.

Warm regards,`
        },
        {
          subject: "Closing the loop on [Role Title]",
          body: `Hi [Name],

Closing the loop — I will not pursue [Role Title] at [Company]. Wishing you a strong hire.

Best regards,`
        }
      ],
      "reply-decline"
    )
  }
];

/**
 * Fill known reply tokens. Leave [Rate], [Start date], and [Times] for the user.
 * Does not insert an email address. Auto-rotates style; skips recentIds.
 * @param {string} id
 * @param {{ contact?: { name?: string, role?: string }, job?: { title?: string, jobTitle?: string, company?: string, companyName?: string }, person?: { name?: string, signatureName?: string, firstName?: string, lastName?: string }, recentIds?: string[] }} [ctx]
 */
export function fillReplyTemplate(id, ctx = {}) {
  const family = REPLY_TEMPLATES.find((t) => t.id === id) || REPLY_TEMPLATES[0];
  const contact = ctx.contact || {};
  const job = ctx.job || {};
  const person = ctx.person || {};
  const seed = `${family.id}|${job.company || job.companyName || ""}|${job.title || job.jobTitle || ""}|${contact.email || contact.name || ""}`;
  const picked = pickRotatingVariant(family.variants || [], {
    seed,
    recentIds: ctx.recentIds || []
  });
  const yourName = String(
    person.name ||
      person.signatureName ||
      [person.firstName, person.lastName].filter(Boolean).join(" ") ||
      ""
  ).trim();
  const known = {
    "[Name]": String(contact.name || "").trim(),
    "[Role Title]": String(job.title || job.jobTitle || "").trim(),
    "[Company]": String(job.company || job.companyName || "").trim(),
    "[Your Name]": yourName
  };
  const fill = (text) => {
    let out = String(text || "");
    for (const [token, value] of Object.entries(known)) {
      if (!value) continue;
      out = out.split(token).join(value);
    }
    return out;
  };
  return {
    id: family.id,
    name: family.name,
    styleId: picked.styleId,
    subject: fill(picked.subject),
    body: fill(picked.body)
  };
}

/**
 * Pick a cold-outreach variant; rotates and skips recent style ids when provided.
 * @param {EmailTemplateFamily} family
 * @param {{ company?: string, title?: string, jdText?: string }} job
 * @param {{ recentIds?: string[] }} [opts]
 */
export function pickTemplateVariant(family, job = {}, opts = {}) {
  const variants = family?.variants || [];
  const seed = `${job.company || ""}|${job.title || ""}|${String(job.jdText || "").slice(0, 240)}`;
  return pickRotatingVariant(variants, { seed, recentIds: opts.recentIds || [] });
}
