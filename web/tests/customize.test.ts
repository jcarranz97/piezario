import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CustomizeSchema } from "../lib/customize";
import { CustomizeError, paramsHash, toArgv } from "../lib/customize";
import type { CustomizeParam } from "../lib/customize-spec";
import {
  APP_OWNED,
  groupParams,
  labelFromOpt,
  parseCustomizeSpec,
} from "../lib/customize-spec";
import { TEST_CONFIG } from "./setup";

/**
 * The customiser's two halves.
 *
 * `parseCustomizeSpec` and `groupParams` are presentation, and are tested for
 * the ordinary reasons. `toArgv` is a trust boundary — everything it sees came
 * from a browser — so most of what is here is about what it *refuses*.
 */

function param(over: Partial<CustomizeParam> & { name: string; opt: string }): CustomizeParam {
  return {
    secondary: null,
    label: labelFromOpt(over.opt),
    help: "",
    type: "float",
    choices: null,
    default: null,
    defaultHint: null,
    required: false,
    placeholder: null,
    source: null,
    dependsOn: null,
    multiple: null,
    entries: [],
    ...over,
  };
}

function schema(params: CustomizeParam[]): CustomizeSchema {
  return { slug: "pets/dogcups", script: "dogcup.py", basic: params, advanced: [] };
}

describe("parseCustomizeSpec", () => {
  it("returns null when there is no generator to drive", () => {
    expect(parseCustomizeSpec(undefined)).toBeNull();
    expect(parseCustomizeSpec({})).toBeNull();
    expect(parseCustomizeSpec({ preview: "stl" })).toBeNull();
  });

  it("refuses a script that is not in the model's own folder", () => {
    expect(parseCustomizeSpec({ script: "../../evil.py" })).toBeNull();
    expect(parseCustomizeSpec({ script: "sub/dir.py" })).toBeNull();
    expect(parseCustomizeSpec({ script: ".hidden.py" })).toBeNull();
  });

  it("accepts a flag with or without its dashes", () => {
    const spec = parseCustomizeSpec({
      script: "dogcup.py",
      defaults: { "inner-radius": 40 },
      basic: ["--cups", "pet-name"],
    })!;
    expect(spec.defaults).toEqual({ "--inner-radius": 40 });
    expect(spec.basic.map((f) => f.opt)).toEqual(["--cups", "--pet-name"]);
  });

  it("reads labelled choices, and treats a bare scalar as its own label", () => {
    const spec = parseCustomizeSpec({
      script: "dogcup.py",
      basic: [
        { opt: "--cups", label: "Size", choices: [{ label: "3/4 cup", value: 0.75 }, 1] },
      ],
    })!;
    expect(spec.basic[0].label).toBe("Size");
    expect(spec.basic[0].choices).toEqual([
      { label: "3/4 cup", value: 0.75 },
      { label: "1", value: 1 },
    ]);
  });
});

describe("groupParams", () => {
  it("groups by flag prefix, but only where a prefix is shared", () => {
    const groups = groupParams([
      param({ name: "paw_size", opt: "--paw-size" }),
      param({ name: "paw_emboss", opt: "--paw-emboss" }),
      param({ name: "freeboard", opt: "--freeboard" }),
      param({ name: "wall", opt: "--wall" }),
    ]);
    expect(groups.map((g) => g.title)).toEqual(["Paw", "General"]);
    expect(groups[0].params.map((p) => p.opt)).toEqual(["--paw-size", "--paw-emboss"]);
    // A lone prefix is not a section of one.
    expect(groups[1].params.map((p) => p.opt)).toEqual(["--freeboard", "--wall"]);
  });
});

describe("a dependent default", () => {
  /**
   * The rule the form implements, kept here so it is asserted somewhere a
   * component test cannot reach: when the controlling field moves, every field
   * that follows it moves too, overwriting whatever was there.
   *
   * It overwrites on purpose. Leaving a hand-typed value alone preserves one
   * that is now wrong — the joint study's revision letter is C for the snap
   * and B for the tongue, and a stale C is engraved on physical parts.
   */
  function applyDependents(
    params: CustomizeParam[],
    values: Record<string, string>,
    name: string,
    next: string,
  ): Record<string, string> {
    const updated = { ...values, [name]: next };
    for (const dependent of params) {
      if (dependent.dependsOn?.name !== name) continue;
      updated[dependent.name] = dependent.dependsOn.map[next] ?? "";
    }
    return updated;
  }

  const params = [
    param({ name: "variant", opt: "--variant", type: "choice" }),
    param({
      name: "revision",
      opt: "--revision",
      type: "text",
      default: "C",
      dependsOn: { name: "variant", map: { snap: "C", tongue: "B", all: "" } },
    }),
  ];

  it("moves the dependent field when its controller changes", () => {
    const after = applyDependents(params, { variant: "snap", revision: "C" },
      "variant", "tongue");
    expect(after.revision).toBe("B");
  });

  it("overwrites a hand-typed value rather than leaving it stale", () => {
    const after = applyDependents(params, { variant: "snap", revision: "Z" },
      "variant", "tongue");
    expect(after.revision).toBe("B");
  });

  it("clears the field where the controller has no mapping", () => {
    // "all" spans every letter, so there is no single one to pre-fill; blank
    // is what makes the script fall back to its own per-part record.
    const after = applyDependents(params, { variant: "snap", revision: "C" },
      "variant", "all");
    expect(after.revision).toBe("");

    const unknown = applyDependents(params, { variant: "snap", revision: "C" },
      "variant", "screw");
    expect(unknown.revision).toBe("");
  });

  it("leaves unrelated fields alone", () => {
    const after = applyDependents(params, { variant: "snap", revision: "C" },
      "revision", "D");
    expect(after).toEqual({ variant: "snap", revision: "D" });
  });
});

describe("toArgv", () => {
  const cups = param({ name: "cups", opt: "--cups", type: "float" });
  const petName = param({ name: "pet_name", opt: "--pet-name", type: "text" });
  const extruder = param({ name: "paw_extruder", opt: "--paw-extruder", type: "integer" });
  const stl = param({ name: "stl", opt: "--stl", type: "flag" });
  const seed = param({ name: "pattern_seed", opt: "--pattern-seed", type: "integer" });

  it("passes through what the schema declares", async () => {
    const argv = await toArgv(schema([cups, petName]), { cups: "0.75", pet_name: "Luna" });
    expect(argv).toEqual(["--cups", "0.75", "--pet-name", "Luna"]);
  });

  describe("a repeatable option", () => {
    const word = param({
      name: "words",
      opt: "--word",
      type: "text",
      multiple: {
        addLabel: "Add name",
        emptyLabel: null,
        separator: ":",
        parts: [
          { key: "text", label: "Name", type: "text", placeholder: null,
            default: null, width: "wide", source: null },
          { key: "times", label: "Times", type: "integer", placeholder: null,
            default: "1", width: "narrow", source: null },
        ],
      },
    });

    it("emits the flag once per row", async () => {
      // The whole point: three JUANs and four ORIANAs is two occurrences of
      // --word, not one value with a comma in it.
      expect(
        await toArgv(schema([word]), { words: ["JUAN:3", "ORIANA:4"] }),
      ).toEqual(["--word", "JUAN:3", "--word", "ORIANA:4"]);
    });

    it("drops the rows nobody filled in", async () => {
      expect(
        await toArgv(schema([word]), { words: ["JUAN:3", "", "   "] }),
      ).toEqual(["--word", "JUAN:3"]);
    });

    it("sends nothing at all when the list is empty", async () => {
      // Which is not the same as sending an empty value: the flag is absent,
      // so the script's own default applies.
      expect(await toArgv(schema([word]), { words: [] })).toEqual([]);
    });

    it("accepts a lone value as one row", async () => {
      expect(await toArgv(schema([word]), { words: "JUAN:3" })).toEqual([
        "--word",
        "JUAN:3",
      ]);
    });

    it("refuses control characters and absurd lengths, per row", async () => {
      await expect(
        toArgv(schema([word]), { words: ["JU\u0007AN", "ORIANA"] }),
      ).rejects.toThrow(/cannot use/);
      await expect(
        toArgv(schema([word]), { words: ["x".repeat(201)] }),
      ).rejects.toThrow(/too long/);
      await expect(
        toArgv(schema([word]), { words: Array(201).fill("A") }),
      ).rejects.toThrow(/more than this form will send/);
    });
  });

  it("drops a parameter the schema does not declare", async () => {
    // The app owns output naming and location; a form must never set them.
    for (const opt of APP_OWNED) {
      expect(opt.startsWith("--")).toBe(true);
    }
    const argv = await toArgv(schema([cups]), {
      cups: "1",
      outdir: "/tmp/pwned",
      name: "pwned",
      fcstd: "on",
    });
    expect(argv).toEqual(["--cups", "1"]);
  });

  it("rejects a number that is not one", async () => {
    await expect(toArgv(schema([cups]), { cups: "0.5; rm -rf /" })).rejects.toBeInstanceOf(
      CustomizeError,
    );
    await expect(toArgv(schema([cups]), { cups: "1e400" })).rejects.toBeInstanceOf(
      CustomizeError,
    );
    // A large-but-real number is not "not a number". The lip balm holder's
    // `--pattern-seed` defaults to 20260730, and an earlier bound sized for
    // millimetres refused the script's own default.
    expect(await toArgv(schema([seed]), { pattern_seed: "20260730" })).toEqual([
      "--pattern-seed",
      "20260730",
    ]);
    await expect(toArgv(schema([extruder]), { paw_extruder: "2.5" })).rejects.toThrow(
      /whole number/,
    );
  });

  it("keeps a blank number as 'leave it to the script', but a blank name as blank", async () => {
    // `--paw-size` unset means "fitted to the floor"; forcing a 0 would mean
    // "no paw at all", which is a different part.
    const pawSize = param({ name: "paw_size", opt: "--paw-size", type: "float" });
    expect(await toArgv(schema([pawSize]), { paw_size: "" })).toEqual([]);
    // An empty `--pet-name` deliberately means a plain handle.
    expect(await toArgv(schema([petName]), { pet_name: "" })).toEqual(["--pet-name", ""]);
  });

  it("only emits a flag when it is on", async () => {
    expect(await toArgv(schema([stl]), { stl: "on" })).toEqual(["--stl"]);
    expect(await toArgv(schema([stl]), { stl: "" })).toEqual([]);
    expect(await toArgv(schema([stl]), { stl: false })).toEqual([]);
  });

  it("refuses a value that is not one of the declared choices", async () => {
    const sized = param({
      name: "cups",
      opt: "--cups",
      type: "text",
      choices: [{ label: "1 cup", value: 1 }, { label: "3/4 cup", value: 0.75 }],
    });
    expect(await toArgv(schema([sized]), { cups: "0.75" })).toEqual(["--cups", "0.75"]);
    await expect(toArgv(schema([sized]), { cups: "9" })).rejects.toThrow(/not one of/);
  });

  it("refuses control characters and over-long text", async () => {
    await expect(
      toArgv(schema([petName]), { pet_name: "Lu\u0007na" }),
    ).rejects.toThrow(/characters it cannot use/);
    await expect(
      toArgv(schema([petName]), { pet_name: "x".repeat(201) }),
    ).rejects.toThrow(/too long/);
  });

  describe("a colour parameter", () => {
    const bodyColour = param({
      name: "body_color",
      opt: "--body-color",
      type: "text",
      source: "filaments",
      choices: [
        { label: "Black", value: "#1a1a1a", hex: "#1a1a1a" },
        { label: "White", value: "#f5f5f5", hex: "#f5f5f5" },
      ],
    });

    it("accepts a colour that is not one of the catalog's presets", async () => {
      // The presets are a shortcut, not a limit: a customer asking for a
      // colour that is not on the shelf is something to price, not something
      // to refuse in a form.
      expect(await toArgv(schema([bodyColour]), { body_color: "#123456" })).toEqual([
        "--body-color",
        "#123456",
      ]);
    });

    it("normalises case so the same colour hashes to the same job", async () => {
      expect(await toArgv(schema([bodyColour]), { body_color: "#AABBCC" })).toEqual([
        "--body-color",
        "#aabbcc",
      ]);
    });

    it("still refuses anything that is not six hex digits", async () => {
      // Open on values, strict on shape — that is what keeps a free picker
      // from widening what can reach the command line.
      for (const bad of ["blue", "#12345", "#1234567", "red; rm -rf /", "rgb(1,2,3)"]) {
        await expect(
          toArgv(schema([bodyColour]), { body_color: bad }),
        ).rejects.toThrow(/must be a colour/i);
      }
    });
  });

  it("will not take a filesystem path for a catalog-bound parameter", async () => {
    // The browser sends a font *id*; the path is resolved server-side. Anything
    // that is not an id in the catalog is refused rather than passed along.
    const fontPath = param({
      name: "font_path",
      opt: "--font-path",
      type: "path",
      source: "fonts",
    });
    await expect(
      toArgv(schema([fontPath]), { font_path: "/etc/passwd" }),
    ).rejects.toThrow(/No such font/);
    await expect(
      toArgv(schema([fontPath]), { font_path: "../../../etc/passwd" }),
    ).rejects.toThrow(/No such font/);
  });
});

describe("paramsHash", () => {
  /**
   * The cache key. This exists because it was once wrong in a way nothing
   * catches: the key was the flags alone, so editing a generator and asking
   * for the same part again returned the file the OLD script had written. The
   * fix looks like it did not work, and the file looks freshly built.
   */
  const vault = path.dirname(TEST_CONFIG);
  const generator = path.join(vault, "models", "gadgets", "box", "box.py");
  let temp: string;

  beforeEach(() => {
    // A throwaway copy, so touching a generator never touches the fixture.
    temp = mkdtempSync(path.join(os.tmpdir(), "piezario-hash-"));
    cpSync(vault, temp, { recursive: true });
    process.env.CATALOG_CONFIG = path.join(temp, path.basename(TEST_CONFIG));
  });

  afterEach(() => {
    process.env.CATALOG_CONFIG = TEST_CONFIG;
    rmSync(temp, { recursive: true, force: true });
  });

  const tempGenerator = () =>
    path.join(temp, path.relative(vault, generator));

  it("is stable for the same flags and the same generators", () => {
    expect(paramsHash("gadgets/box", ["--size", "40"])).toBe(
      paramsHash("gadgets/box", ["--size", "40"]),
    );
  });

  it("separates different flags, models and argument order", () => {
    const base = paramsHash("gadgets/box", ["--size", "40"]);
    expect(paramsHash("gadgets/box", ["--size", "41"])).not.toBe(base);
    expect(paramsHash("decor/vase", ["--size", "40"])).not.toBe(base);
  });

  it("changes when a generator is edited, so a fixed script is never cached over", () => {
    const before = paramsHash("gadgets/box", ["--size", "40"]);
    writeFileSync(tempGenerator(), "# edited\n", { flag: "a" });
    expect(paramsHash("gadgets/box", ["--size", "40"])).not.toBe(before);
  });

  it("changes when a generator in ANOTHER model is edited", () => {
    // Not paranoia: color-swatch-container imports the card's own script from
    // color-swatch, and several models keep a copy of bambu3mf.py. A key that
    // only watched this model's folder would serve a stale case forever.
    const before = paramsHash("gadgets/box", ["--size", "40"]);
    writeFileSync(path.join(temp, "models", "decor", "vase", "vase.py"), "x = 1\n");
    expect(paramsHash("gadgets/box", ["--size", "40"])).not.toBe(before);
  });

  it("is still a 16-character hex id, so jobDir keeps accepting it", () => {
    expect(paramsHash("gadgets/box", ["--size", "40"])).toMatch(/^[0-9a-f]{16}$/);
  });
});
