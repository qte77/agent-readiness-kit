import { describe, expect, it } from "vitest";

import { PROPERTIES, parseProperties } from "../../config/properties.js";

const valid = { id: "example-site", url: "https://example.com/docs/", label: "example.com" };

describe("parseProperties", () => {
  it("returns the entries of a valid list unchanged", () => {
    expect(parseProperties([valid])).toEqual([valid]);
  });

  it.each([
    ["a non-array", { properties: [valid] }],
    ["an empty list", []],
    ["a non-object entry", ["https://example.com"]],
    ["a missing label", [{ id: valid.id, url: valid.url }]],
    ["a blank label", [{ ...valid, label: "  " }]],
    ["an id with a dot", [{ ...valid, id: "example.com" }]],
    ["an id with a slash", [{ ...valid, id: "example/site" }]],
    ["an uppercase id", [{ ...valid, id: "Example-Site" }]],
    ["a non-URL url", [{ ...valid, url: "example.com" }]],
    ["a non-http(s) url", [{ ...valid, url: "ftp://example.com" }]],
    ["a duplicate id", [valid, { ...valid, url: "https://other.example" }]],
  ])("rejects %s", (_name, input) => {
    expect(() => parseProperties(input)).toThrow(/properties/);
  });

  it("names the offending entry in the error", () => {
    expect(() => parseProperties([valid, { ...valid, id: "Bad.Id" }])).toThrow(/\[1\]/);
  });
});

describe("PROPERTIES", () => {
  it("still scans the three original properties", () => {
    expect(PROPERTIES.map((p) => p.id)).toEqual(
      expect.arrayContaining(["qte77-github-io", "agenthud-agui-a2ui", "sortmy-london"]),
    );
  });
});
