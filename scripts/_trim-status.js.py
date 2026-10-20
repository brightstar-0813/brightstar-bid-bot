from pathlib import Path

path = Path(r"d:\Work\JobHunting\Prompts\Bots\brightstar-auto-apply-bot\popup.js")
t = path.read_text(encoding="utf-8")

repls = [
    ('message: "Started — watch the status bar for progress."', 'message: "Started."'),
    (
        "csvExtensionIdHintEl.textContent = `Extension ID (for native-host install): ${id}`;",
        'csvExtensionIdHintEl.textContent = id ? `Ext ID: ${id}` : "";',
    ),
    (
        "? `CSV auto-source saved — polling every ${res.alarm.minutes} min.`",
        "? `Auto-source · every ${res.alarm.minutes}m`",
    ),
    (': "CSV auto-source saved (polling off)."', ': "Auto-source saved."'),
    (
        ": `Pinned ${file.name} — +${ingest.added || 0} new · ${ingest.pending || 0} pending. Review jobs, then click Start.`",
        ": `Pinned ${file.name} · +${ingest.added || 0} · ${ingest.pending || 0} pending`",
    ),
    (
        ": `Refreshed pinned CSV — +${ingest.added || 0} new · ${ingest.pending || 0} pending. Review jobs, then click Start.`",
        ": `Refreshed · +${ingest.added || 0} · ${ingest.pending || 0} pending`",
    ),
    (
        ': `Refreshed via ${res.via || "source"} — +${r.added || 0} new · ${r.pending || 0} pending. Review jobs, then click Start.`',
        ': `Refreshed (${res.via || "source"}) · +${r.added || 0} · ${r.pending || 0} pending`',
    ),
    (
        'setStatus("Refresh finished. Configure Auto-source settings if nothing changed.");',
        'setStatus("Refresh done.");',
    ),
    (
        'setStatus(res.status || "Auto apply running — watch the status bar.");',
        'setStatus(res.status || "Auto apply running.");',
    ),
    (
        'setStatus(res.status || "Apply started — sheet marked, filling the form in the job tab.");',
        'setStatus(res.status || "Apply started.");',
    ),
    (
        'setStatus("Apps Script copied. Paste into the spreadsheet, then Deploy → New deployment (Web app).");',
        'setStatus("Apps Script copied.");',
    ),
    (
        'setStatus("Non-US market — batch queue hidden. Use Manual bid for each job.");',
        'setStatus("Non-US.");',
    ),
    (
        'setStatus("US market — CSV queue and batch controls available.");',
        'setStatus("US.");',
    ),
    (
        "setStatus(`Filled from open tab${site}. Review fields, then Draft.`);",
        "setStatus(`Filled from tab${site}.`);",
    ),
    (
        'setStatus("Draft preview focused — Confirm when ready.");',
        'setStatus("Draft preview focused.");',
    ),
    (
        'setStatus("Opened draft preview — Confirm when ready.");',
        'setStatus("Draft preview opened.");',
    ),
    (
        'setStatus("Active person needs a tailor prompt with {JD} (auto-filled from each CSV job). Open the person editor.");',
        'setStatus("Prompt needs {JD}.");',
    ),
    (
        'setStatus("Upload or paste a master resume (text/PDF/DOCX) — not JSON.");',
        'setStatus("Master resume required.");',
    ),
    (
        'setStatus("Autofill is off. Turn it on in Apply assist.");',
        'setStatus("Autofill is off.");',
    ),
    (
        'setStatus("Opening panel and autofilling the application tab…");',
        'setStatus("Autofilling…");',
    ),
    (
        'setStatus(res?.error || "Autofill failed. Click the application tab, then try again.");',
        'setStatus(res?.error || "Autofill failed.");',
    ),
    (
        'setStatus(res.statusText || formatAutofillSummary(res) || "Autofill complete — check the panel on the application page.");',
        'setStatus(res.statusText || formatAutofillSummary(res) || "Autofill complete.");',
    ),
    (
        'setStatus("OpenAI Custom Q&A is off. Enable the toggle to scan leftovers on the page.");',
        'setStatus("OpenAI Custom Q&A is off.");',
    ),
    (
        'setStatus("Custom Q&A: answering special questions with OpenAI…");',
        'setStatus("Custom Q&A…");',
    ),
    (
        'setStatus(res?.error || "Custom Q&A failed. Focus the application tab, then try again.");',
        'setStatus(res?.error || "Custom Q&A failed.");',
    ),
    (
        'setStatus("Custom Q&A: paste a question, pick OpenAI or AI tab, then Generate.");',
        'setStatus("Enter a question.");',
    ),
    (
        '? "Custom Q&A: asking ChatGPT/Claude tab (uses subscription)…"',
        '? "Custom Q&A · AI tab…"',
    ),
    (
        '? "Custom Q&A: generating with stronger OpenAI model…"',
        '? "Custom Q&A · strong…"',
    ),
    (': "Custom Q&A: generating with OpenAI…"', ': "Custom Q&A…"'),
    (
        "setStatus(`Custom Q&A ready (${src}). Copy or Save to bank.`);",
        "setStatus(`Custom Q&A ready (${src}).`);",
    ),
    (
        'setStatus("Could not copy — select the answer and copy manually.");',
        'setStatus("Copy failed.");',
    ),
    (
        'setStatus("Job list cleared. Upload a CSV to start again.");',
        'setStatus("Queue cleared.");',
    ),
    (
        'setStatus("Reset complete. Job list cleared — ready for a new CSV.");',
        'setStatus("Reset complete.");',
    ),
    (
        'setStatus("New profile — fill details and Save.")',
        'setStatus("New profile.")',
    ),
    (
        'setStatus(res?.error || "Auto Apply failed. Focus the application tab first.");',
        'setStatus(res?.error || "Auto Apply failed.");',
    ),
    (
        'retryBtn.title = "Reset this job and run it again";',
        'retryBtn.removeAttribute("title");',
    ),
]

n = 0
for a, b in repls:
    c = t.count(a)
    if c:
        t = t.replace(a, b)
        n += c
        print("ok", c, a[:55])
    else:
        print("miss", a[:70])

path.write_text(t, encoding="utf-8")
print("total", n)
