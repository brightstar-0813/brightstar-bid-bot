from pathlib import Path

path = Path(__file__).resolve().parents[1] / "popup.html"
text = path.read_text(encoding="utf-8")

manual_start = text.index("        <!-- Manual one-off -->")
indeed_start = text.index("        <!--\n          Indeed grab UI")
apply_start = text.index("        <!-- Apply -->")
email_start = text.index("        <!-- Email Bid (hiring contacts")

manual_block = text[manual_start:indeed_start]
indeed_block = text[indeed_start:apply_start]
apply_block = text[apply_start:email_start]

text = text[:manual_start] + apply_block + indeed_block + manual_block + text[email_start:]

text = text.replace(
    'id="applyStepNum" aria-hidden="true">6</span>',
    'id="applyStepNum" aria-hidden="true">5</span>',
    1,
)
text = text.replace(
    'id="manualStepNum" aria-hidden="true">5</span>',
    'id="manualStepNum" aria-hidden="true">6</span>',
    1,
)

old_c = """        <!--
          Indeed grab UI — kept for future work; currently hidden (not numbered in the live flow).
          When re-enabling: insert as step 6 and bump Apply assist → 7, Integrations → 8.
        -->"""
new_c = """        <!--
          Indeed grab UI — kept for future work; currently hidden (not numbered in the live flow).
          When re-enabling: insert after Jobs and renumber Apply assist / Manual / Email / Integrations.
        -->"""
if old_c not in text:
    raise SystemExit("Indeed comment not found")
text = text.replace(old_c, new_c, 1)

path.write_text(text, encoding="utf-8")
idx_a = text.index('id="applySection"')
idx_m = text.index('id="manualSection"')
idx_e = text.index('id="emailBidSection"')
print("ok", idx_a < idx_m < idx_e)
