import { fireEvent, render, screen } from "@testing-library/react";
import { ModalSurface } from "./ModalSurface";

it("traps keyboard focus including selects and restores focus and scrolling on close", () => {
  const trigger = document.createElement("button");
  document.body.appendChild(trigger);
  trigger.focus();
  const close = vi.fn();
  const { unmount } = render(<ModalSurface label="测试弹窗" onClose={close}><input aria-label="名称" /><select aria-label="方式"><option>默认</option></select><button>保存</button></ModalSurface>);
  const input = screen.getByLabelText("名称");
  const select = screen.getByLabelText("方式");
  const save = screen.getByRole("button", { name: "保存" });
  expect(input).toHaveFocus();
  expect(document.body.style.overflow).toBe("hidden");
  select.focus();
  fireEvent.keyDown(select, { key: "Tab" });
  expect(select).toHaveFocus(); // interior traversal is left to the browser
  save.focus();
  fireEvent.keyDown(save, { key: "Tab" });
  expect(input).toHaveFocus();
  fireEvent.keyDown(input, { key: "Tab", shiftKey: true });
  expect(save).toHaveFocus();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(close).toHaveBeenCalledTimes(1);
  unmount();
  expect(trigger).toHaveFocus();
  expect(document.body.style.overflow).toBe("");
  expect(trigger.inert).toBeFalsy();
  trigger.remove();
});

it("does not reset text focus on rerender and uses the latest close callback", () => {
  const oldClose = vi.fn();
  const newClose = vi.fn();
  const content = <><input aria-label="名称" /><textarea aria-label="备注" /></>;
  const { rerender } = render(<ModalSurface label="测试" onClose={oldClose}>{content}</ModalSurface>);
  screen.getByLabelText("备注").focus();
  rerender(<ModalSurface label="测试" onClose={newClose}>{content}</ModalSurface>);
  expect(screen.getByLabelText("备注")).toHaveFocus();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(newClose).toHaveBeenCalledOnce();
  expect(oldClose).not.toHaveBeenCalled();
});


it("prioritizes the requested field over earlier optional fields", () => {
  render(<ModalSurface label="新建订单" onClose={vi.fn()}><textarea aria-label="粘贴地址" /><input data-autofocus aria-label="联系人" /></ModalSurface>);
  expect(screen.getByLabelText("联系人")).toHaveFocus();
});
