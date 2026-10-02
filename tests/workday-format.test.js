import assert from "node:assert/strict";
import test from "node:test";
import { formatPhoneForWorkday, formatZipForWorkday } from "../autofill-workday-format.js";

test("formatPhoneForWorkday strips +1 for US national field", () => {
  assert.equal(formatPhoneForWorkday("+1 (317) 563-1795"), "(317) 563-1795");
  assert.equal(formatPhoneForWorkday("13175631795"), "(317) 563-1795");
  assert.equal(formatPhoneForWorkday("3175631795"), "(317) 563-1795");
});

test("formatZipForWorkday enforces US 5 or ZIP+4", () => {
  assert.equal(formatZipForWorkday("49445", "United States"), "49445");
  assert.equal(formatZipForWorkday("49445-1234", "US"), "49445-1234");
  assert.equal(formatZipForWorkday("494451234", "USA"), "49445-1234");
  assert.equal(formatZipForWorkday("1470", "United States"), "");
  assert.equal(formatZipForWorkday("M5V 2T6", "Canada"), "M5V 2T6");
});
