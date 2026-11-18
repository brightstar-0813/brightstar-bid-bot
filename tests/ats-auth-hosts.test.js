import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "content/ats-auth-hosts.js"), "utf8");
const sandbox = {};
sandbox.globalThis = sandbox;
vm.runInNewContext(src, sandbox);
const { isEmployerAtsAuthHost } = sandbox.BrightstarAtsAuthHosts;

test("employer ATS sign-in hosts allow credential fill (Q35)", () => {
  for (const host of [
    "signin-us.ultipro.com",
    "recruiting.ultipro.com",
    "careers-acme.icims.com",
    "acme.taleo.net",
    "career5.successfactors.com",
    "eihu.fa.us8.oraclecloud.com"
  ]) {
    assert.equal(isEmployerAtsAuthHost(host), true, host);
  }
});

test("job boards and aggregators never get credentials", () => {
  for (const host of [
    "himalayas.app",
    "jobgether.com",
    "auth.jobgether.com",
    "builtin.com",
    "accounts.builtin.com",
    "www.linkedin.com",
    "secure.indeed.com",
    "www.dice.com",
    "jobright.ai",
    "accounts.google.com",
    "login.microsoftonline.com",
    "notultipro.com.evil.example",
    ""
  ]) {
    assert.equal(isEmployerAtsAuthHost(host), false, host);
  }
});

test("suffix match requires a dot boundary", () => {
  assert.equal(isEmployerAtsAuthHost("ultipro.com"), true);
  assert.equal(isEmployerAtsAuthHost("fakeultipro.com"), false);
});
