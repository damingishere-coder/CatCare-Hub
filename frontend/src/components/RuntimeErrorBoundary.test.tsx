import { render, screen } from "@testing-library/react";

import { RuntimeErrorBoundary } from "./RuntimeErrorBoundary";

function BrokenPage(): never {
  throw new Error("测试渲染异常");
}

it("keeps recovery navigation when a page render crashes", () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);

  render(
    <RuntimeErrorBoundary>
      <BrokenPage />
    </RuntimeErrorBoundary>,
  );

  expect(screen.getByRole("heading", { name: "页面遇到异常，但导航仍可使用" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "重新加载" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "工作台" })).toHaveAttribute(
    "href",
    "http://127.0.0.1:5180/admin",
  );
  expect(screen.getByRole("link", { name: "订单" })).toHaveAttribute(
    "href",
    "http://127.0.0.1:5180/admin/orders",
  );
  expect(screen.getByRole("link", { name: "路线" })).toHaveAttribute(
    "href",
    "http://127.0.0.1:5180/admin/routes",
  );
});
