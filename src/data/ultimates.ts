import { Character, Faction } from './factions';

/** Shared full-screen choreographies; each character picks one and a colour. */
export type UltTemplate = 'slash' | 'charge' | 'arrows' | 'fire' | 'water' | 'shock' | 'summon' | 'glyph';

export const ULT_TEMPLATES: UltTemplate[] = ['slash', 'charge', 'arrows', 'fire', 'water', 'shock', 'summon', 'glyph'];

const DEFAULT_COLOR: Record<UltTemplate, string> = {
  slash: '#ffe9b0',
  charge: '#ffd27a',
  arrows: '#ffe08a',
  fire: '#ff8a30',
  water: '#5fc8ff',
  shock: '#ffcf5a',
  summon: '#f2d27a',
  glyph: '#9fe0ff',
};

/** Template per character id, with an optional colour when the default does not suit them. */
const ASSIGNMENT: Record<string, UltTemplate | [UltTemplate, string]> = {
  // 楚
  'xiang-yu': 'fire',
  'fan-zeng': 'glyph',
  'yu-ji': ['slash', '#ff9ec4'],
  'xiang-liang': 'summon',
  'xiang-bo': 'slash',
  'long-ju': 'water',
  'zhongli-mo': 'slash',
  'ji-bu': 'shock',
  'yu-ziqi': 'charge',
  'ying-bu': ['charge', '#ff6a4a'],
  'xiang-zhuang': 'slash',
  jiangdong: 'water',
  // 漢
  'liu-bang': ['fire', '#ff5a3a'],
  'zhang-liang': 'arrows',
  'xiao-he': 'slash',
  'chen-ping': 'glyph',
  'cao-shen': 'shock',
  'han-xin': 'summon',
  'fan-kuai': 'shock',
  'guan-ying': 'charge',
  'xiahou-ying': 'charge',
  'peng-yue': 'fire',
  'zhou-bo': 'summon',
  'han-soldier': ['summon', '#ff8a7a'],
  // 蜀
  'liu-bei': 'summon',
  'zhuge-liang': 'fire',
  'pang-tong': ['fire', '#ffb04a'],
  'fa-zheng': 'shock',
  'jiang-wan': 'glyph',
  'guan-yu': ['slash', '#5be3a0'],
  'zhang-fei': 'shock',
  'zhao-yun': ['charge', '#dfe9ff'],
  'ma-chao': ['charge', '#cfe0ff'],
  'huang-zhong': 'arrows',
  'wei-yan': 'slash',
  baier: ['summon', '#e8f0ff'],
  // 魏
  'cao-cao': 'glyph',
  'guo-jia': 'arrows',
  'xun-yu': 'glyph',
  'sima-yi': ['slash', '#b58cff'],
  'jia-xu': ['glyph', '#c8a0ff'],
  'zhang-liao': 'charge',
  'xiahou-dun': ['shock', '#ff4a3a'],
  'dian-wei': 'shock',
  'xu-chu': 'charge',
  'xu-huang': 'slash',
  'zhang-he': 'slash',
  hubaoqi: ['charge', '#9aa8c8'],
  // 吳
  'sun-quan': 'water',
  'zhou-yu': 'fire',
  'lu-su': 'slash',
  'lu-xun': 'fire',
  'lu-meng': 'water',
  'gan-ning': 'fire',
  'taishi-ci': 'shock',
  'sun-ce': 'charge',
  'zhou-tai': 'shock',
  'huang-gai': 'fire',
  'cheng-pu': 'slash',
  jiefan: 'water',
  // 秦
  'qin-shihuang': 'arrows',
  'li-si': 'glyph',
  'wei-liao': 'summon',
  'shang-yang': 'shock',
  'fan-ju': 'glyph',
  'bai-qi': ['shock', '#d83a3a'],
  'wang-jian': 'summon',
  'meng-tian': 'charge',
  'wang-ben': 'water',
  'sima-cuo': 'arrows',
  'zhang-han': 'summon',
  'qin-ruishi': ['summon', '#c9b27a'],
  // 唐
  'li-shimin': 'charge',
  'fang-xuanling': 'glyph',
  'du-ruhui': 'slash',
  'wei-zheng': 'glyph',
  'zhangsun-wuji': 'summon',
  'qin-qiong': 'shock',
  'yuchi-gong': 'charge',
  'li-jing': ['charge', '#cfe6ff'],
  'cheng-yaojin': 'slash',
  'xue-rengui': 'arrows',
  'li-ji': 'summon',
  xuanjia: ['charge', '#8a98b8'],
  // 宋
  'zhao-kuangyin': 'shock',
  'bao-zheng': 'slash',
  'kou-zhun': 'summon',
  'fan-zhongyan': 'summon',
  'wen-tianxiang': 'glyph',
  'yue-fei': 'charge',
  'yang-ye': 'slash',
  'han-shizhong': 'water',
  'di-qing': 'fire',
  'liang-hongyu': 'shock',
  'zong-ze': 'water',
  beiwei: 'slash',
};

export interface UltimateSpec {
  template: UltTemplate;
  /** Main effect colour (CSS hex). */
  color: string;
  /** Calligraphy title and the one-line description shown under it. */
  title: string;
  line: string;
}

export function ultimateFor(ch: Character, _faction?: Faction): UltimateSpec {
  const entry = ASSIGNMENT[ch.id] ?? 'slash';
  const [template, color] = Array.isArray(entry) ? entry : [entry, DEFAULT_COLOR[entry]];
  return { template, color, title: ch.skill.name, line: ch.skill.desc };
}

export const hasUltimateAssignment = (id: string) => id in ASSIGNMENT;
export const assignedIds = () => Object.keys(ASSIGNMENT);
