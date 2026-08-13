import { describe, expect, it } from "vitest";
import { imageCaptureKeyboard, studyCaptureModulePickerKeyboard } from "./studyCapture";
import { studyCaptureBatchKeyboard } from "../services/studyCaptureBatches";

describe("Study image capture controls", () => {
  it("keeps OCR opt-in and labels caption editing accurately", () => {
    expect(imageCaptureKeyboard("capture-token", false, false).inline_keyboard).toEqual([
      [
        { text: "Save image", callback_data: "study:cap:image:capture-token" },
        { text: "Add caption", callback_data: "study:cap:caption:capture-token" },
      ],
      [{ text: "Extract text", callback_data: "study:cap:ocr:capture-token" }],
      [
        { text: "Choose module", callback_data: "study:cap:choose:capture-token" },
        { text: "Cancel", callback_data: "study:cap:ignore:capture-token" },
      ],
    ]);

    const afterOcr = imageCaptureKeyboard("capture-token", true, true).inline_keyboard.flat();
    expect(afterOcr).toContainEqual({ text: "Edit caption", callback_data: "study:cap:caption:capture-token" });
    expect(afterOcr).toContainEqual({ text: "Save with text", callback_data: "study:cap:ocrsave:capture-token" });
  });

  it("paginates module choices five at a time and keeps callbacks within Telegram limits", () => {
    const modules = Array.from({ length: 12 }, (_, index) => ({ code: `CS${2100 + index}` }));
    const rows = studyCaptureModulePickerKeyboard(modules, "abcdefghijkl", "imagemenu", 1).inline_keyboard;
    const buttons = rows.flat();
    const moduleButtons = buttons.filter((button) => button.text.startsWith("CS"));

    expect(moduleButtons.map((button) => button.text)).toEqual(modules.slice(5, 10).map((module) => module.code));
    expect(buttons).toContainEqual({ text: "2/3", callback_data: "study:capmods:abcdefghijkl:imagemenu:1" });
    expect(buttons).toContainEqual({ text: "Cancel", callback_data: "study:cap:ignore:abcdefghijkl" });
    expect(buttons.every((button) => !("callback_data" in button) || Buffer.byteLength(button.callback_data, "utf8") <= 64)).toBe(true);
  });

  it("offers one coherent action menu for a Telegram image album", () => {
    const rows = studyCaptureBatchKeyboard("batch-token").inline_keyboard;
    expect(rows).toEqual([
      [{ text: "Save all images", callback_data: "study:capb:save:batch-token" }],
      [
        { text: "Add shared caption", callback_data: "study:capb:caption:batch-token" },
        { text: "Choose module", callback_data: "study:capb:choose:batch-token" },
      ],
      [{ text: "Cancel batch", callback_data: "study:capb:ignore:batch-token" }],
    ]);
    expect(rows.flat().every((button) => Buffer.byteLength(button.callback_data, "utf8") <= 64)).toBe(true);
  });
});
