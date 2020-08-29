/**
 * 导出一个 Mirai 类，具体见类的各个属性和方法。
 * @packageDocumentation
 */

import * as axios from "./axios";
import { AxiosStatic } from "axios";
import MiraiApiHttp from "./mirai-api-http";
import { MessageType, EventType, MiraiApiHttpConfig } from ".";
import * as log from "./utils/log";
import { getPlain } from "./utils";
import { isMessage } from "./utils/check";

type Listener = Map<
  MessageType.ChatMessageType | EventType.EventType,
  Function[]
>;

/**
 * 数据类型
 */
type Data<
  T extends "message" | EventType.EventType | MessageType.ChatMessageType
> = T extends EventType.EventType
  ? EventType.EventMap[T]
  : T extends MessageType.ChatMessageType
  ? MessageType.ChatMessageMap[T]
  : MessageType.ChatMessage;

/**
 * Mirai SDK 初始化类
 */
export default class Mirai {
  /**
   * 封装 mirai-api-http 的固有方法
   */
  api: MiraiApiHttp;
  /**
   * 请求工具
   */
  axios: AxiosStatic;
  /**
   * sessionKey 是使用以下方法必须携带的 sessionKey 使用前必须进行校验和绑定指定的Bot，每个 Session 只能绑定一个 Bot，但一个 Bot 可有多个Session。
   * sessionKey 在未进行校验的情况下，一定时间后将会被自动释放。
   */
  sessionKey: string;
  qq: number;
  /**
   * 是否验证成功
   */
  verified: boolean;
  /**
   * 监听者（回调函数）
   */
  listener: Listener;
  /**
   * 轮询获取消息的时间间隔，默认 200 ms，仅在未开启 Websocket 时有效
   */
  interval: number;
  /**
   * 当前处理的消息
   */
  curMsg?: MessageType.ChatMessage | EventType.Event;
  constructor(
    public mahConfig: MiraiApiHttpConfig = {
      host: "0.0.0.0",
      port: 8080,
      authKey: "el-psy-congroo",
      cacheSize: 4096,
      enableWebsocket: false,
      cors: ["*"],
    }
  ) {
    this.axios = axios.init(
      `http://${this.mahConfig.host}:${this.mahConfig.port}`
    );
    this.api = new MiraiApiHttp(this.mahConfig, this.axios);

    // default
    this.sessionKey = "";
    this.qq = 0;
    this.verified = false;

    this.listener = new Map();
    this.interval = 200;
  }

  /**
   * @deprecated since version v0.5.0
   */
  login(qq: number) {
    log.error("mirai.login(qq) 请使用 miria.link(qq) 替代");
  }

  /**
   * link 链接 mirai 已经登录的 QQ 号
   */
  async link(qq: number) {
    this.qq = qq;
    // Todo
    const { session } = await this.auth();
    this.sessionKey = session;
    return await this.verify();
  }

  /**
   * 获取 Session
   */
  auth() {
    return this.api.auth();
  }

  /**
   * 激活 Session，绑定 QQ
   */
  verify() {
    return this.api.verify(this.qq);
  }

  /**
   * 释放 Session
   */
  release() {
    return this.api.release();
  }

  /**
   * 绑定事件列表
   * message: FriendMessage | GroupMessage | TempMessage
   * [mirai-api-http事件类型一览](https://github.com/project-mirai/mirai-api-http/blob/master/EventType.md)
   * mirai.on('MemberMuteEvent', ()=>{})
   * @param type
   * @param callback
   */
  on<T extends "message" | EventType.EventType | MessageType.ChatMessageType>(
    type: T,
    callback: (data: Data<T>) => any
  ) {
    // too complex for typescript so that in some case it cannot identify the type correctly
    // 说明监听所有
    if (type === "message") {
      this.addListener("FriendMessage", callback);
      this.addListener("GroupMessage", callback);
      this.addListener("TempMessage", callback);
    } else {
      this.addListener(type as Exclude<T, "message">, callback);
    }
  }

  /**
   * 添加监听者
   * @param type
   * @param callback
   */
  addListener<T extends EventType.EventType | MessageType.ChatMessageType>(
    type: T,
    callback: Function
  ) {
    const set = this.listener.get(type);
    if (set) {
      set.push(callback);
    } else {
      this.listener.set(type, [callback]);
    }
  }

  /**
   * 快速回复（只在消息类型包含群组或好友信息时有效）
   * @param msg 发送内容（消息链/纯文本皆可）
   * @param srcMsg 回复哪条消息
   * @param quote 是否引用回复（非聊天消息类型时无效）
   */
  reply(
    msgChain: string | MessageType.MessageChain,
    srcMsg: EventType.Event | MessageType.ChatMessage,
    quote = false
  ) {
    let messageId = 0;
    let target = 0;
    let type = "friend";

    if (isMessage(srcMsg)) {
      if (quote && srcMsg.messageChain[0].type === "Source") {
        messageId = srcMsg.messageChain[0].id;
      }
    }

    // reply 不同的目标
    switch (srcMsg.type) {
      case "TempMessage":
      case "FriendMessage":
        type = "friend";
        target = srcMsg.sender.id;
        break;
      case "GroupMessage":
        type = "group";
        target = srcMsg.sender.group.id;
        break;
      case "BotOnlineEvent":
      case "BotOfflineEventActive":
      case "BotOfflineEventForce":
      case "BotOfflineEventDropped":
      case "BotReloginEvent":
        type = "friend";
        target = srcMsg.qq;
        break;
      case "GroupRecallEvent":
      case "BotGroupPermissionChangeEvent":
      case "BotJoinGroupEvent":
      case "GroupNameChangeEvent":
      case "GroupEntranceAnnouncementChangeEvent":
      case "GroupMuteAllEvent":
      case "GroupAllowAnonymousChatEvent":
      case "GroupAllowConfessTalkEvent":
      case "GroupAllowMemberInviteEvent":
        type = "group";
        break;
      case "MemberJoinEvent":
      case "MemberLeaveEventKick":
      case "MemberLeaveEventQuit":
      case "MemberCardChangeEvent":
      case "MemberSpecialTitleChangeEvent":
      case "MemberPermissionChangeEvent":
      case "MemberMuteEvent":
      case "MemberUnmuteEvent":
        type = "group";
        target = srcMsg.member.group.id;
        break;
      case "MemberJoinRequestEvent":
        type = "group";
        target = srcMsg.groupId;
        break;
      default:
        break;
    }

    if (type === "friend") {
      return this.api.sendFriendMessage(msgChain, target, messageId);
    } else if (type === "group") {
      return this.api.sendGroupMessage(msgChain, target, messageId);
    }
  }

  /**
   * 为消息类型挂载辅助函数
   * @param msg
   */
  addHelperForMsg(msg: MessageType.ChatMessage | EventType.Event) {
    // 消息类型添加直接获取消息内容的参数
    if (
      msg.type === "FriendMessage" ||
      msg.type === "GroupMessage" ||
      msg.type === "TempMessage"
    ) {
      msg.plain = getPlain(msg.messageChain);
    }

    // 为各类型添加 reply 辅助函数
    (msg as any).reply = async (
      msgChain: string | MessageType.MessageChain,
      quote = false
    ) => {
      this.reply(msgChain, msg, quote);
    };
  }

  /**
   * 处理消息
   * @param msg 一条消息
   */
  handle(msg: MessageType.ChatMessage | EventType.Event) {
    this.curMsg = msg;
    const set = this.listener.get(msg.type);
    if (set) {
      set.forEach((callback) => {
        this.addHelperForMsg(msg);
        callback(msg);
      });
    }
  }

  /**
   * 监听消息和事件
   * @param callback 回调函数
   */
  listen(callback?: Function) {
    const address = this.mahConfig.host + ":" + this.mahConfig.port;
    if (this.mahConfig.enableWebsocket) {
      this.api.all((msg) => {
        this.handle(msg);
        if (callback) {
          callback(msg);
        }
      });
    } else {
      log.info("开始监听: http://" + address);
      setInterval(async () => {
        const { data } = await this.api.fetchMessage();
        if (data && data.length) {
          data.forEach((msg) => {
            this.handle(msg);
            if (callback) {
              callback(msg);
            }
          });
        }
      }, this.interval);
    }
  }
}
