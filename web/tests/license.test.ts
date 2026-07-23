import { describe, expect, it } from "vitest";

import { detectLicense, isLicenseFile } from "../lib/license";

describe("isLicenseFile", () => {
  it("recognises the common license filenames, case-insensitively", () => {
    for (const name of [
      "LICENSE",
      "license",
      "LICENCE",
      "LICENSE.txt",
      "License.md",
      "COPYING",
    ]) {
      expect(isLicenseFile(name), name).toBe(true);
    }
  });

  it("rejects unrelated filenames", () => {
    expect(isLicenseFile("README.md")).toBe(false);
    expect(isLicenseFile("license-notes.md")).toBe(false);
    expect(isLicenseFile("model.stl")).toBe(false);
  });
});

describe("detectLicense", () => {
  it("names licenses from their signature text", () => {
    expect(
      detectLicense("Permission is hereby granted, free of charge, to any"),
    ).toBe("MIT");
    expect(detectLicense("SIL OPEN FONT LICENSE Version 1.1")).toBe("SIL OFL");
    expect(detectLicense("Apache License, Version 2.0")).toBe("Apache 2.0");
    expect(
      detectLicense("This is free and unencumbered software released into the public domain"),
    ).toBe("Unlicense");
  });

  it("distinguishes GPL versions, preferring the more specific match", () => {
    expect(
      detectLicense("GNU GENERAL PUBLIC LICENSE\nVersion 3, 29 June 2007"),
    ).toBe("GPL-3.0");
    expect(
      detectLicense("GNU GENERAL PUBLIC LICENSE\nVersion 2, June 1991"),
    ).toBe("GPL-2.0");
  });

  it("returns null when the text is not a recognised license", () => {
    expect(detectLicense("Just some notes about this model.")).toBeNull();
    expect(detectLicense("")).toBeNull();
  });
});
