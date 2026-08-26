import { Bike, Bus, Car, Truck, type LucideIcon } from "lucide-react";

/**
 * ANPR gateways send free-form vehicle types (car, CAR, motorbike, 2-wheeler…),
 * so match on a normalized value and fall back to a generic label + icon.
 */
const VEHICLE_TYPES: { match: string[]; label: string; Icon: LucideIcon }[] = [
  { match: ["car", "sedan", "suv", "hatchback", "van"], label: "Car", Icon: Car },
  { match: ["truck", "lorry", "trailer", "pickup"], label: "Truck", Icon: Truck },
  { match: ["bus", "coach", "minibus"], label: "Bus", Icon: Bus },
  {
    match: ["bike", "motorbike", "motorcycle", "scooter", "2-wheeler"],
    label: "Motorbike",
    Icon: Bike,
  },
];

export function vehicleTypeMeta(value: string | null | undefined) {
  const raw = (value || "").trim();
  if (!raw) return null;
  const normalized = raw.toLowerCase().replaceAll("_", " ");
  const hit = VEHICLE_TYPES.find((entry) =>
    entry.match.some((token) => normalized.includes(token))
  );
  return {
    label: hit ? hit.label : raw.charAt(0).toUpperCase() + raw.slice(1),
    Icon: hit ? hit.Icon : Car,
  };
}
