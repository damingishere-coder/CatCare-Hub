import { registerPwa } from "./register";

function setSecureContext(value: boolean) {
  Object.defineProperty(window, "isSecureContext", {
    configurable: true,
    value,
  });
}

it("registers the root-scoped service worker in a secure context", async () => {
  setSecureContext(true);
  const registration = {} as ServiceWorkerRegistration;
  const registrar = {
    register: vi.fn().mockResolvedValue(registration),
  } as unknown as Pick<ServiceWorkerContainer, "register">;

  await expect(registerPwa(registrar)).resolves.toBe(registration);
  expect(registrar.register).toHaveBeenCalledWith("/sw.js", {
    scope: "/",
    updateViaCache: "none",
  });
});

it("does not register outside a secure context", async () => {
  setSecureContext(false);
  const registrar = {
    register: vi.fn(),
  } as unknown as Pick<ServiceWorkerContainer, "register">;

  await expect(registerPwa(registrar)).resolves.toBeNull();
  expect(registrar.register).not.toHaveBeenCalled();
});

it("does not break the app when registration fails", async () => {
  setSecureContext(true);
  const registrar = {
    register: vi.fn().mockRejectedValue(new Error("P11 expected test failure")),
  } as unknown as Pick<ServiceWorkerContainer, "register">;

  await expect(registerPwa(registrar)).resolves.toBeNull();
});
