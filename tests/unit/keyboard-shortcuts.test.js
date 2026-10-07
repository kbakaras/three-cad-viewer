import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { KeyMapper, shortcutKey } from "../../src/utils/utils.js";
import { cleanup, setupViewer } from "../helpers/setup.js";

describe("physical shortcut keys", () => {
  let shortcuts;

  beforeEach(() => {
    shortcuts = KeyMapper.getActionShortcuts();
  });

  afterEach(() => {
    KeyMapper.setActionShortcuts(shortcuts);
  });

  test.each(["t", "е", "ث", "Dead"])("KeyT overrides key %s", (key) => {
    expect(
      shortcutKey(new KeyboardEvent("keydown", { code: "KeyT", key })),
    ).toBe("t");
  });

  test.each([
    ["T", false, "t"],
    ["t", true, "T"],
    ["Е", false, "t"],
    ["е", true, "T"],
  ])("Shift alone chooses the case for key %s", (key, shiftKey, expected) => {
    const event = new KeyboardEvent("keydown", { code: "KeyT", key, shiftKey });
    expect(shortcutKey(event)).toBe(expected);
  });

  test.each(Array.from("0123456789"))(
    "Digit%s is independent of layout",
    (digit) => {
      const code = `Digit${digit}`;
      expect(
        shortcutKey(new KeyboardEvent("keydown", { code, key: "é" })),
      ).toBe(digit);
      expect(
        shortcutKey(
          new KeyboardEvent("keydown", { code, key: "?", shiftKey: true }),
        ),
      ).toBe(")!@#$%^&*("[Number(digit)]);
    },
  );

  test.each([
    ["Slash", "/", "?"],
    ["BracketLeft", "[", "{"],
    ["Quote", "'", '"'],
    ["Space", " ", " "],
  ])("normalizes %s and Shift", (code, plain, shifted) => {
    expect(shortcutKey(new KeyboardEvent("keydown", { code, key: "?" }))).toBe(
      plain,
    );
    expect(
      shortcutKey(
        new KeyboardEvent("keydown", { code, key: "?", shiftKey: true }),
      ),
    ).toBe(shifted);
  });

  test.each([
    ["Escape", "Escape"],
    ["Backspace", "Backspace"],
    ["Numpad5", "5"],
    ["Numpad5", "Clear"],
    ["NumpadDecimal", ","],
    ["", "t"],
    ["Unidentified", "t"],
    ["IntlYen", "¥"],
  ])("preserves key %s / %s when not normalized", (code, key) => {
    expect(shortcutKey(new KeyboardEvent("keydown", { code, key }))).toBe(key);
  });

  test("preserves custom shortcut settings and key-only lookup", () => {
    KeyMapper.setActionShortcuts({ transparent: "q", tree: "Q", help: "?" });
    expect(
      KeyMapper.getActionForEvent(
        new KeyboardEvent("keydown", {
          code: "KeyQ",
          key: "й",
        }),
      ),
    ).toBe("transparent");
    expect(
      KeyMapper.getActionForEvent(
        new KeyboardEvent("keydown", {
          code: "KeyQ",
          key: "Й",
          shiftKey: true,
        }),
      ),
    ).toBe("tree");
    expect(
      KeyMapper.getActionForEvent(
        new KeyboardEvent("keydown", {
          code: "Slash",
          key: ",",
          shiftKey: true,
        }),
      ),
    ).toBe("help");
    expect(KeyMapper.getActionForKey("q")).toBe("transparent");
    expect(KeyMapper.getActionShortcuts()).toEqual({
      transparent: "q",
      tree: "Q",
      help: "?",
    });
  });

  test("does not fall back to a conflicting key when code is supported", () => {
    KeyMapper.setActionShortcuts({ transparent: "t" });
    expect(
      KeyMapper.getActionForEvent(
        new KeyboardEvent("keydown", {
          code: "KeyQ",
          key: "t",
        }),
      ),
    ).toBeUndefined();
  });
});

describe("viewer keyboard shortcuts", () => {
  let fixture;
  let dispatch;

  beforeEach(() => {
    fixture = setupViewer();
    dispatch = vi
      .spyOn(fixture.display, "_dispatchAction")
      .mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup(fixture);
    vi.restoreAllMocks();
  });

  function press(options, target = fixture.container) {
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ...options,
    });
    target.dispatchEvent(event);
    return event;
  }

  test.each([
    ["KeyT", "е", false, "transparent"],
    ["KeyT", "Е", false, "transparent"],
    ["KeyT", "е", true, "tree"],
    ["KeyG", "п", false, "grid"],
    ["KeyG", "п", true, "gridxy"],
    ["KeyI", "ш", false, "isolateSelection"],
    ["Digit5", "(", false, "iso"],
  ])("dispatches %s / %s with Shift=%s", (code, key, shiftKey, action) => {
    expect(press({ code, key, shiftKey }).defaultPrevented).toBe(true);
    expect(dispatch).toHaveBeenCalledExactlyOnceWith(action);
  });

  test.each(["ctrlKey", "altKey", "metaKey", "isComposing"])(
    "ignores %s",
    (flag) => {
      expect(
        press({ code: "KeyT", key: "е", [flag]: true }).defaultPrevented,
      ).toBe(false);
      expect(dispatch).not.toHaveBeenCalled();
    },
  );

  test.each([false, true])("ignores repeated KeyI with Alt=%s", (altKey) => {
    press({ code: "KeyI", key: "ш", altKey, repeat: true });
    expect(dispatch).not.toHaveBeenCalled();
  });

  test.each(["i", "ш", "Ш"])("Alt+KeyI overrides layout %s", (key) => {
    expect(press({ code: "KeyI", key, altKey: true }).defaultPrevented).toBe(
      true,
    );
    expect(dispatch).toHaveBeenCalledExactlyOnceWith("hideSelection");
  });

  test.each(["ctrlKey", "metaKey", "shiftKey", "isComposing"])(
    "Alt+KeyI ignores extra %s",
    (flag) => {
      expect(
        press({ code: "KeyI", key: "ш", altKey: true, [flag]: true })
          .defaultPrevented,
      ).toBe(false);
      expect(dispatch).not.toHaveBeenCalled();
    },
  );

  test("KeyO no longer dispatches hideSelection", () => {
    press({ code: "KeyO", key: "щ" });
    expect(dispatch).not.toHaveBeenCalled();
  });

  test("modifier bindings are configurable without affecting plain keys", () => {
    fixture.viewer.setKeyMap({ hideSelection: "Alt+q", isolateSelection: "i" });
    press({ code: "KeyQ", key: "й", altKey: true });
    expect(dispatch).toHaveBeenCalledExactlyOnceWith("hideSelection");
    dispatch.mockClear();
    press({ code: "KeyI", key: "ш", altKey: true });
    press({ code: "KeyQ", key: "й" });
    expect(dispatch).not.toHaveBeenCalled();
  });

  test.each(["input", "textarea", "select", "contenteditable"])(
    "ignores typing in %s",
    (kind) => {
      const target = document.createElement(
        kind === "contenteditable" ? "div" : kind,
      );
      if (kind === "contenteditable") target.contentEditable = "true";
      fixture.container.appendChild(target);
      const child =
        kind === "contenteditable"
          ? target.appendChild(document.createElement("span"))
          : target;
      expect(press({ code: "KeyT", key: "е" }, child).defaultPrevented).toBe(
        false,
      );
      expect(dispatch).not.toHaveBeenCalled();
      press({ code: "KeyI", key: "ш", altKey: true }, child);
      expect(dispatch).not.toHaveBeenCalled();
    },
  );

  test.each(["button", "checkbox"])(
    "allows shortcuts on an input %s",
    (type) => {
      const input = document.createElement("input");
      input.type = type;
      fixture.container.appendChild(input);
      press({ code: "KeyT", key: "е" }, input);
      expect(dispatch).toHaveBeenCalledExactlyOnceWith("transparent");
    },
  );

  test("Escape closes the material editor even from a text field", () => {
    const editor = fixture.container.querySelector(".tcv_mat_editor");
    editor.style.display = "block";
    const input = editor.appendChild(document.createElement("input"));
    const close = vi
      .spyOn(fixture.display, "closeMatEditor")
      .mockImplementation(() => {});
    press({ code: "Escape", key: "Escape" }, input);
    expect(close).toHaveBeenCalledOnce();
    expect(dispatch).not.toHaveBeenCalled();
  });

  test("Escape during composition does not close the material editor", () => {
    fixture.container.querySelector(".tcv_mat_editor").style.display = "block";
    const close = vi
      .spyOn(fixture.display, "closeMatEditor")
      .mockImplementation(() => {});
    press({ code: "Escape", key: "Escape", isComposing: true });
    expect(close).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
