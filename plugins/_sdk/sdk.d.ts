/**
 * ClassIntra 市场应用 SDK 类型定义（frontend / market-apps 专用）
 *
 * 市场应用（market-apps/<name>/）的前端是原生 ES module，由宿主注入 context 对象——
 * 这是第三方应用与宿主交互的【唯一编程接口】。本文件给出完整类型，供 TS 开发者
 * `/// <reference path="..." />` 引用或直接复制进项目，编辑器即可获得完整补全。
 *
 * 实现源码：client/src/core/market-sdk.js（五大命名空间）+ market-registry.js（生命周期）
 * 生态文档：docs/ecosystem-design.md §4
 *
 * 命名空间总览：
 *   context.ui      —— 预制 iOS 风格 DOM 片段（12 个）
 *   context.data    —— 数据能力（api / realtime / websocket / storage）
 *   context.system  —— 系统能力（user / theme / router / toast / modal / navbar）
 *   context.app     —— 应用自身（name / version / manifest / config / log / onDestroy）
 *   context.compat  —— 兼容探测（chromeVersion / isX5 / has）
 *
 * 注意：context 顶层的 api/websocket/route/router/user/modal 等是 v1 兼容别名（TODO: v2 移除），
 * 新代码一律走命名空间路径（如 context.data.api、context.system.router）。
 */

// ============================================================
// 一、应用入口定义（window.ClassIntraMarket.define 的参数）
// ============================================================

/**
 * 市场应用入口定义。entry.js 末尾调用：
 *   window.ClassIntraMarket.define(definition)
 *
 * 契约：资源回收必须在 context.app.onDestroy 中登记（宿主卸载时会先调它，
 * 再调 definition.unmount，最后做容器级计时器/监听器审计回收）。
 */
export interface MarketAppDefinition {
  /** 应用名，必须与 manifest.json 的 name（即目录名）一致 */
  name: string;
  /**
   * 挂载：宿主把容器 DOM 与 SDK context 交给应用。
   * 应用应在 container 内自建 DOM 并自行绑事件。
   */
  mount(container: HTMLElement, context: MarketContext): void;
  /** 可选卸载：移除容器内容、解绑容器级事件（onDestroy 已覆盖大部分场景） */
  unmount?(container: HTMLElement): void;
}

/** 全局注册表（entry.js 加载完成即应调用 define） */
declare global {
  interface Window {
    ClassIntraMarket: {
      /** 注册应用入口（entry.js 顶层调用一次） */
      define(definition: MarketAppDefinition): MarketAppDefinition;
      /** 已注册的定义表（只读用途） */
      apps: Record<string, MarketAppDefinition>;
    };
  }
}

// ============================================================
// 二、manifest 类型（context.app.manifest）
// ============================================================

/** 应用 manifest（市场应用安装后由 market-service 提供的运行时视图） */
export interface AppManifest {
  /** kebab-case 唯一标识，与目录名一致 */
  name: string;
  type: 'app' | 'system';
  /** 语义化版本 x.y.z */
  version: string;
  /** 显示名（桌面上展示） */
  label: string;
  description?: string;
  author?: string;
  /** 图标路径（./ 开头的相对路径由宿主重写为 /market-static/<name>/...） */
  icon?: string;
  /** 主题色（hex） */
  color?: string;
  category?: 'desktop' | 'system' | 'hidden';
  /** 桌面排序权重，越小越靠前（默认 99） */
  order?: number;
  defaultEnabled?: boolean;
  canDisable?: boolean;
  /** 能力披露清单（安装前告知用户） */
  capabilities?: string[];
  frontend?: {
    route: string;
    routeName: string;
    /** 原生 ES module 入口 */
    entry: string;
    /** 样式表（可选） */
    style?: string;
  };
  backend?: {
    mountPath: string;
    entry: string;
    rateLimit?: { max: number; windowMs: number; message?: string };
  };
  /** 应用自定义配置（context.app.config 读取处） */
  config?: Record<string, unknown>;
  [key: string]: unknown;
}

// ============================================================
// 三、SDK Context
// ============================================================

/** 路由目标：字符串路径或 Vue Router location 对象 */
export type RouteLocation = string | { path: string; query?: Record<string, string> };

/** 模态选项（context.system.modal / toast 共用） */
export interface ModalOptions {
  title?: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
}

/** 应用内上下文（mount 的第二个参数） */
export interface MarketContext {
  /** 应用名（与 manifest.name 一致） */
  appName: string;
  /** SDK 契约版本（当前 '1'） */
  version: string;

  // ---- context.ui：预制 iOS 风格 DOM 片段（实现见 client/src/core/market-sdk-ui.js） ----
  ui: {
    button(options?: Record<string, unknown>): HTMLElement;
    card(options?: Record<string, unknown>): HTMLElement;
    list(options?: Record<string, unknown>): HTMLElement;
    badge(options?: Record<string, unknown>): HTMLElement;
    segmented(options?: Record<string, unknown>): HTMLElement;
    toggle(options?: Record<string, unknown>): HTMLElement;
    searchBar(options?: Record<string, unknown>): HTMLElement;
    emptyState(options?: Record<string, unknown>): HTMLElement;
    spinner(options?: Record<string, unknown>): HTMLElement;
    toast(options?: Record<string, unknown>): HTMLElement;
    sectionTitle(options?: Record<string, unknown>): HTMLElement;
    toolbar(options?: Record<string, unknown>): HTMLElement;
    /** 底层工具：创建元素并批量设置属性/子节点 */
    el(tag: string, attrs?: Record<string, unknown>, children?: Array<Node | string>): HTMLElement;
  };

  // ---- context.data：数据能力 ----
  data: {
    /** 宿主 axios 实例（自动带登录态与统一错误处理） */
    api: ApiClient;
    /** 实时事件通道（宿主推送总线） */
    realtime: RealtimeChannel | null;
    /** WebSocket 连接（与宿主共用） */
    websocket: WebSocket | null;
    /**
     * 隔离存储：所有键自动加 'ci:app:<appName>:' 前缀，避免与宿主/其他应用冲突；
     * 值自动 JSON 序列化；get 的 fallback 在键不存在时返回
     */
    storage: {
      /** 命名空间前缀（供诊断） */
      prefix: string;
      get<T = unknown>(key: string, fallback?: T): T | null;
      set(key: string, value: unknown): boolean;
      remove(key: string): boolean;
      keys(): string[];
      /** 清空本应用全部键，返回清除数量 */
      clear(): number;
    };
    /** 便捷 GET：等价 data.api.get（api 不可用时 reject） */
    get(url: string, options?: Record<string, unknown>): Promise<any>;
    /** 便捷 POST：等价 data.api.post（api 不可用时 reject） */
    post(url: string, body?: unknown, options?: Record<string, unknown>): Promise<any>;
  };

  // ---- context.system：系统能力 ----
  system: {
    /** 当前登录用户（响应式 getter，未登录为 null；字段见后端 user 表） */
    readonly user: {
      user_id?: string | number;
      id?: string | number;
      net_name?: string;
      [key: string]: unknown;
    } | null;
    /** 是否已登录 */
    readonly isLoggedIn: boolean;
    /** 当前路由（响应式 getter） */
    readonly route: { path: string; params: Record<string, string>; query: Record<string, string> } | null;
    /** Vue Router 实例（应用内跳转/返回桌面） */
    router: {
      push(location: RouteLocation): Promise<void>;
      [key: string]: unknown;
    } | null;
    /** 主题引擎（读取当前 token） */
    theme: unknown | null;
    /** 读取设计令牌（token-injector 收集的 CSS 变量值） */
    getToken(name: string): string;
    /** 宿主事件总线（emit/on；跨模块通信用，分享类跳转请优先 router.push） */
    eventBus: { emit(event: string, payload?: unknown): void; on(event: string, fn: (payload: any) => void): void; off?(event: string, fn: (payload: any) => void): void } | null;
    /** 提示三件套（内部走 modal，缺失时安全降级 resolve） */
    toast: {
      alert(options: ModalOptions): Promise<boolean>;
      confirm(options: ModalOptions): Promise<boolean>;
      prompt(options: ModalOptions): Promise<string | null>;
    };
    /** 模态框（原生 Promise 返回） */
    modal: {
      alert(options: ModalOptions): Promise<boolean>;
      confirm(options: ModalOptions): Promise<boolean>;
      prompt(options: ModalOptions): Promise<string | null>;
      [key: string]: unknown;
    } | null;
    /** 返回桌面（应用内提供「退出」入口时使用） */
    goDesktop(): void;
    /** 跳转路由（等价 router.push，router 缺失时安全 no-op） */
    navigate(location: RouteLocation): Promise<void>;
  };

  // ---- context.app：应用自身 ----
  app: {
    name: string;
    version: string;
    /** 应用 manifest（运行时视图） */
    manifest: AppManifest | null;
    /** manifest.config 中的自定义配置 */
    config: Record<string, unknown>;
    /**
     * 注册清理函数（契约优于约定）：应用卸载时自动调用（逆序、幂等）；
     * 计时器/监听器/WebSocket 分片等一律在此登记，否则会被宿主审计器强制回收
     */
    onDestroy(fn: () => void): void;
    /** 统一前缀日志（[app:<name>]） */
    log(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
  };

  // ---- context.compat：兼容探测 ----
  compat: {
    /** Chrome 主版本（X5 内核按 MQQBrowser 推断；未知为 0） */
    chromeVersion: number;
    /** 是否腾讯 X5/TBS 内核 */
    isX5: boolean;
    /**
     * 能力探测。常用键：'flex-gap'（Chrome 84+）/ 'backdrop-filter' / 'webp' /
     * 'container-query' / 'clipboard' / 'resize-observer' / 'intersection-observer' /
     * 'passive-events' / 'css-vars' / 'local-storage'
     */
    has(name: string): boolean;
    /** 低于 80 基线（建议给出降级提示） */
    isBelowBaseline: boolean;
  };

  // ---- v1 兼容别名（TODO: v2 移除，新代码不要依赖） ----
  /** @deprecated 用 context.data.api */
  readonly api: ApiClient | null;
  /** @deprecated 用 context.data.websocket */
  readonly websocket: WebSocket | null;
  /** @deprecated 用 context.data.realtime */
  readonly realtime: RealtimeChannel | null;
  /** @deprecated 用 context.data.realtime */
  readonly realtimeEvents: RealtimeChannel | null;
  /** @deprecated 用 context.system.route */
  readonly route: MarketContext['system']['route'];
  /** @deprecated 用 context.system.router */
  readonly router: MarketContext['system']['router'];
  /** @deprecated 用 context.system.user */
  readonly user: MarketContext['system']['user'];
  /** @deprecated 用 context.system.theme */
  readonly theme: unknown;
  /** @deprecated 用 context.system.eventBus */
  readonly eventBus: MarketContext['system']['eventBus'];
  /** @deprecated 用 context.system.toast */
  readonly toast: MarketContext['system']['toast'];
  /** @deprecated 用 context.system.modal */
  readonly modal: MarketContext['system']['modal'];
}

// ============================================================
// 四、底层客户端（宽松类型：宿主 axios 封装，返回体已含统一 code 字段）
// ============================================================

/** 宿主 API 客户端（axios 封装；响应为后端统一 { code, message, data? } 结构） */
export interface ApiClient {
  get(url: string, config?: Record<string, unknown>): Promise<any>;
  post(url: string, body?: unknown, config?: Record<string, unknown>): Promise<any>;
  put(url: string, body?: unknown, config?: Record<string, unknown>): Promise<any>;
  delete(url: string, config?: Record<string, unknown>): Promise<any>;
}

/** 实时事件通道（宿主推送总线；on 返回解绑函数） */
export interface RealtimeChannel {
  on(event: string, fn: (payload: any) => void): void;
  off(event: string, fn: (payload: any) => void): void;
  emit?(event: string, payload?: unknown): void;
  [key: string]: unknown;
}
