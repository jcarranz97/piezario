/**
 * Recognising a LICENSE file and naming what's in it.
 *
 * Both a model folder and a font folder can carry a licence — a downloaded
 * model comes with terms, and a Google Font ships its OFL. GitHub surfaces
 * this as a small scales-of-justice link, which is the right amount of
 * prominence: it matters, but it isn't what you came to the page for.
 *
 * Detection is deliberately shallow. It reads the first few lines and matches
 * the handful of licences that actually turn up on printable models and fonts;
 * anything it doesn't recognise still shows up, just labelled "License".
 */

/** LICENSE, LICENCE, LICENSE.txt, LICENSE.md, COPYING — case-insensitive. */
const LICENSE_FILENAME = /^(licen[cs]e|copying)(\.(txt|md))?$/i;

export function isLicenseFile(name: string): boolean {
  return LICENSE_FILENAME.test(name);
}

/** Ordered: the more specific pattern has to win. */
const SIGNATURES: Array<[RegExp, string]> = [
  [/SIL OPEN FONT LICENSE/i, "SIL OFL"],
  [/Apache License/i, "Apache 2.0"],
  [/GNU AFFERO GENERAL PUBLIC LICENSE/i, "AGPL"],
  [/GNU LESSER GENERAL PUBLIC LICENSE/i, "LGPL"],
  [/GNU GENERAL PUBLIC LICENSE[\s\S]{0,200}Version 3/i, "GPL-3.0"],
  [/GNU GENERAL PUBLIC LICENSE[\s\S]{0,200}Version 2/i, "GPL-2.0"],
  [/GNU GENERAL PUBLIC LICENSE/i, "GPL"],
  [/Mozilla Public License/i, "MPL 2.0"],
  [/Attribution-NonCommercial-ShareAlike/i, "CC BY-NC-SA"],
  [/Attribution-NonCommercial-NoDerivat/i, "CC BY-NC-ND"],
  [/Attribution-NonCommercial/i, "CC BY-NC"],
  [/Attribution-ShareAlike/i, "CC BY-SA"],
  [/Attribution-NoDerivat/i, "CC BY-ND"],
  [/CC0|Creative Commons Zero/i, "CC0"],
  [/Creative Commons Attribution/i, "CC BY"],
  [/This is free and unencumbered software released into the public domain/i, "Unlicense"],
  [/Redistribution and use in source and binary forms[\s\S]{0,600}Neither the name/i, "BSD 3-Clause"],
  [/Redistribution and use in source and binary forms/i, "BSD 2-Clause"],
  [/MIT License|Permission is hereby granted, free of charge/i, "MIT"],
];

/** A short label for the licence, or null when it isn't one we know. */
export function detectLicense(text: string): string | null {
  const head = text.slice(0, 4000);
  for (const [pattern, label] of SIGNATURES) {
    if (pattern.test(head)) {
      return label;
    }
  }
  return null;
}
