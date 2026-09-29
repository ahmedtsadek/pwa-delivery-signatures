export type DeliveryOutcome =
  | 'PENDING'
  | 'DELIVERED'
  | 'RECIPIENT_NOT_AVAILABLE'
  | 'REFUSED'
  | 'PACKAGE_NOT_PROVIDED'
  | 'UNABLE_TO_ACCESS'
  | 'WRONG_PACKAGE'
  | 'OTHER';

export type RecipientRelationship =
  | 'SELF'
  | 'CAREGIVER'
  | 'PARENT'
  | 'SIBLING'
  | 'CHILD'
  | 'FACILITY_STAFF'
  | 'OTHER';

export const STOP_SERVICE_MINUTES = 5;

export function estimateRouteMinutes(drivingMinutes: number, stopCount: number) {
  return Math.max(0, Math.round(drivingMinutes)) + Math.max(0, stopCount) * STOP_SERVICE_MINUTES;
}
