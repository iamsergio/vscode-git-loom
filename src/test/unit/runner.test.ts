import * as assert from "assert";
import { parseAgentLine } from "../../loom/runner";

suite("parseAgentLine", () => {
  test("parses a single-line JSON status", () => {
    const agent = parseAgentLine('{"status":"ok"}');
    assert.deepStrictEqual(agent, { status: "ok" });
  });

  test("takes the last non-empty line when there's other stderr noise", () => {
    const stderr = ["warning: something", "", '{"status":"ok","messages":["did a thing"]}', ""].join(
      "\n",
    );
    const agent = parseAgentLine(stderr);
    assert.deepStrictEqual(agent, { status: "ok", messages: ["did a thing"] });
  });

  test("parses an error status with a message", () => {
    const agent = parseAgentLine('{"status":"error","message":"boom"}');
    assert.deepStrictEqual(agent, { status: "error", message: "boom" });
  });

  test("returns undefined for non-JSON stderr", () => {
    assert.strictEqual(parseAgentLine("some plain error text"), undefined);
  });

  test("returns undefined for empty stderr", () => {
    assert.strictEqual(parseAgentLine(""), undefined);
  });

  test("returns undefined for JSON without a recognized status field", () => {
    assert.strictEqual(parseAgentLine('{"foo":"bar"}'), undefined);
  });
});
