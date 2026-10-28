import { expect, test } from "bun:test";
import { isPickerCancel, pickFileSink, type SaveFilePicker } from "./download-writer";

test("the picker sink forwards writes and closes the chosen file", async () => {
  const writes: Uint8Array[] = [];
  let closed = false;
  let suggested = "";
  const picker: SaveFilePicker = async (options) => {
    suggested = options?.suggestedName || "";
    return {
      createWritable: async () => ({
        write: async (bytes) => { writes.push(bytes); },
        close: async () => { closed = true; },
        abort: async () => undefined,
      }),
    };
  };
  const sink = await pickFileSink("dist/app.zip", picker);
  await sink.write(new Uint8Array([1, 2]));
  await sink.close();
  expect(suggested).toBe("dist/app.zip");
  expect([...writes[0]]).toEqual([1, 2]);
  expect(closed).toBeTrue();
});

test("a picker cancel is recognized separately from a download failure", () => {
  expect(isPickerCancel(new DOMException("canceled", "AbortError"))).toBeTrue();
  expect(isPickerCancel(new Error("network"))).toBeFalse();
  expect(isPickerCancel(null)).toBeFalse();
});
