export type RobotStatusCode = 0 | 1;

export type RobotStatusLabel = "AVAILABLE" | "IN_USE";

export interface RobotRecord {
  robotId: string;
  name: string;
  service: string;
  robotOwner: string;
  status: RobotStatusCode;
  registered: boolean;
}
