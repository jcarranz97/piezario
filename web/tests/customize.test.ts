import { describe, expect, it } from "vitest";

import type { CustomizeSchema } from "../lib/customize";
import { CustomizeError, toArgv } from "../lib/customize";
import type { CustomizeParam } from "../lib/customize-spec";
import {
  APP_OWNED,
  groupParams,
  labelFromOpt,
  parseCustomizeSpec,
} from "../lib/customize-spec";

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
