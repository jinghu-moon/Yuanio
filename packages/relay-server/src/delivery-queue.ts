export function resolveDeliveryTargets(
  target: string | null | undefined,
  sourceDeviceId: string,
  devices: { id: string }[],
): string[] {
  if (!target) return [];
  if (target === "broadcast") {
    return devices
      .map((d) => d.id)
      .filter((id) => id && id !== sourceDeviceId);
  }
  if (target === sourceDeviceId) return [];
  return [target];
}
