/**
 * Adapter 通用契约。
 * 每个具体框架/库实现这个接口，mapper 编排所有 adapter 输出 FeatureMap。
 */

import type {
  ApiSpec,
  AuthSpec,
  DataSpec,
  PageSpec,
  ProjectProfile,
  ProjectRisk,
} from '@sentinel/core';

export interface ProjectScan {
  /** 项目根目录绝对路径 */
  root: string;
  /** 已读取的 package.json（如果有） */
  packageJson?: Record<string, unknown>;
  /** 文件存在检查 */
  has(relPath: string): boolean;
  /** 读取文件内容 */
  read(relPath: string): Promise<string | null>;
  /** 列举目录 */
  list(relPath: string): Promise<string[]>;
}

export interface Adapter {
  /** Adapter 名称 */
  readonly name: string;
  /** 检查项目是否使用此栈 */
  detect(scan: ProjectScan): Promise<boolean>;
  /** 提取项目档案信息（detect=true 时调用） */
  profile?(scan: ProjectScan): Promise<Partial<ProjectProfile>>;
  /** 路由识别 */
  routes?(scan: ProjectScan): Promise<{ pages?: PageSpec[]; api?: ApiSpec[] }>;
  /** 认证识别 */
  auth?(scan: ProjectScan): Promise<AuthSpec | undefined>;
  /** 数据层识别 */
  data?(scan: ProjectScan): Promise<DataSpec[]>;
  /** 项目风险点识别 */
  risks?(scan: ProjectScan): Promise<ProjectRisk[]>;
}
