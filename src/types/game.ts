import * as THREE from 'three';

export type CombatStyle = 'blades' | 'pistols' | 'siege';
export type CorpsFaction = 'survey' | 'anti_personnel' | 'garrison';
export type GameMode = 'campaign' | 'endless' | 'training' | 'titan_playable';
export type ArenaId = 'town' | 'forest' | 'ramparts';
export type WeatherId = 'dusk' | 'storm' | 'dawn' | 'moon';
export type TitanArchetype = 'normal' | 'sprinter' | 'crawler' | 'abnormal' | 'tank' | 'armored' | 'beast' | 'warhammer' | 'founder';
export type LimbZone = 'leftLeg' | 'rightLeg' | 'leftArm' | 'rightArm' | 'eyes' | 'torso' | 'nape';

export interface LimbStatus {
  leftLeg: number;
  rightLeg: number;
  leftArm: number;
  rightArm: number;
  eyes: number;
  torso: number;
}

export interface RagdollState {
  active: boolean;
  t: number;
  hipVel: THREE.Vector3;
  rotVel: THREE.Vector3;
  limbVels: number[];
  settled: boolean;
}

export interface ChapterDef {
  id: string;
  num: string;
  title: string;
  arena: ArenaId;
  weather: WeatherId;
  waves: number;
  convoy: boolean;
  boss: TitanArchetype | false;
  subtitle: string;
  unlockReward: { type: string; id: string; label: string };
  loreTitle: string;
  loreDate: string;
  loreQuote: string;
  loreBody: string;
}

export interface ScoreBreakdown {
  total: number;
  rank: 'S' | 'A' | 'B' | 'C';
  combatScore: number;
  speedBonus: number;
  styleBonus: number;
  survivalBonus: number;
  districtBonus: number;
}

export interface KeyBinds {
  forward: string;
  back: string;
  left: string;
  right: string;
  hookL: string;
  hookR: string;
  reel: string;
  boost: string;
  reloadBlade: string;
  reloadGas: string;
  spear: string;
  command: string;
  interact: string;
  roll: string;
  hookMode: string;
  viewToggle: string;
  help: string;
}
