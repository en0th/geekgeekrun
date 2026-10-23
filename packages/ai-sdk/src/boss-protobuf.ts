/** Lossless proto2 codec recovered from the shipped cn.techwolf.boss.chat schema.
 * This code is an independent implementation; it never evaluates the app bundle.
 */
export type BossId = string | bigint | number;
export class BossProtocolError extends Error {
  constructor(message: string) { super(message); this.name = 'BossProtocolError'; }
}
export interface BossUnknownField { tag: number; wireType: number; bytes: Uint8Array }
export interface BossUser extends Record<string, unknown> { uid: string; name?: string; source?: number }
export interface BossMessageBody extends Record<string, unknown> {
  type: number; templateId: number; text?: string;
  action?: { aid: number; extend?: string };
}
export interface BossMessage extends Record<string, unknown> {
  from: BossUser; to: BossUser; type: number; body: BossMessageBody;
  mid?: string; cmid?: string; time?: string; status?: number; securityId?: string;
}
export interface BossMessageRead extends Record<string, unknown> {
  userId: string; messageId: string; readTime: string; sync?: boolean; userSource?: number;
}
export interface BossChatProtocol extends Record<string, unknown> {
  type: number; messages?: BossMessage[]; messageRead?: BossMessageRead[];
}
interface ProtoField { name: string; tag: number; type: string; rule: string; defaultValue?: unknown }
// SCHEMA_GENERATED_START
const SCHEMA: Record<string, readonly ProtoField[]> = {
  "TechwolfUser": [
    {
      "name": "uid",
      "tag": 1,
      "type": "int64",
      "rule": "required"
    },
    {
      "name": "name",
      "tag": 2,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "avatar",
      "tag": 3,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "company",
      "tag": 4,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "headImg",
      "tag": 5,
      "type": "int32",
      "rule": "optional"
    },
    {
      "name": "certification",
      "tag": 6,
      "type": "int32",
      "rule": "optional"
    },
    {
      "name": "source",
      "tag": 7,
      "type": "int32",
      "rule": "optional"
    }
  ],
  "TechwolfSound": [
    {
      "name": "sid",
      "tag": 1,
      "type": "int64",
      "rule": "optional"
    },
    {
      "name": "url",
      "tag": 2,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "duration",
      "tag": 3,
      "type": "int32",
      "rule": "optional"
    },
    {
      "name": "templateId",
      "tag": 4,
      "type": "int32",
      "rule": "optional"
    }
  ],
  "TechwolfVideo": [
    {
      "name": "type",
      "tag": 1,
      "type": "int32",
      "rule": "required"
    },
    {
      "name": "status",
      "tag": 2,
      "type": "int32",
      "rule": "required"
    },
    {
      "name": "duration",
      "tag": 3,
      "type": "int32",
      "rule": "optional"
    },
    {
      "name": "text",
      "tag": 4,
      "type": "string",
      "rule": "optional"
    }
  ],
  "TechwolfInterview": [
    {
      "name": "condition",
      "tag": 1,
      "type": "int32",
      "rule": "required"
    },
    {
      "name": "text",
      "tag": 2,
      "type": "string",
      "rule": "required"
    },
    {
      "name": "url",
      "tag": 3,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "extend",
      "tag": 4,
      "type": "string",
      "rule": "optional"
    }
  ],
  "TechwolfImageInfo": [
    {
      "name": "url",
      "tag": 1,
      "type": "string",
      "rule": "required"
    },
    {
      "name": "width",
      "tag": 2,
      "type": "int32",
      "rule": "required"
    },
    {
      "name": "height",
      "tag": 3,
      "type": "int32",
      "rule": "required"
    }
  ],
  "TechwolfImage": [
    {
      "name": "iid",
      "tag": 1,
      "type": "int64",
      "rule": "optional"
    },
    {
      "name": "tinyImage",
      "tag": 2,
      "type": "TechwolfImageInfo",
      "rule": "optional"
    },
    {
      "name": "originImage",
      "tag": 3,
      "type": "TechwolfImageInfo",
      "rule": "optional"
    }
  ],
  "TechwolfAction": [
    {
      "name": "aid",
      "tag": 1,
      "type": "int32",
      "rule": "required"
    },
    {
      "name": "extend",
      "tag": 2,
      "type": "string",
      "rule": "optional"
    }
  ],
  "TechwolfArticle": [
    {
      "name": "title",
      "tag": 1,
      "type": "string",
      "rule": "required"
    },
    {
      "name": "description",
      "tag": 2,
      "type": "string",
      "rule": "required"
    },
    {
      "name": "picUrl",
      "tag": 3,
      "type": "string",
      "rule": "required"
    },
    {
      "name": "url",
      "tag": 4,
      "type": "string",
      "rule": "required"
    },
    {
      "name": "templateId",
      "tag": 5,
      "type": "int32",
      "rule": "optional"
    },
    {
      "name": "bottomText",
      "tag": 6,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "timeout",
      "tag": 7,
      "type": "int64",
      "rule": "optional"
    },
    {
      "name": "statisticParameters",
      "tag": 8,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "highlightParts",
      "tag": 9,
      "type": "TechwolfSlice",
      "rule": "repeated"
    },
    {
      "name": "dimParts",
      "tag": 10,
      "type": "TechwolfSlice",
      "rule": "repeated"
    },
    {
      "name": "subTitle",
      "tag": 11,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "extend",
      "tag": 12,
      "type": "string",
      "rule": "optional"
    }
  ],
  "TechwolfNotify": [
    {
      "name": "text",
      "tag": 1,
      "type": "string",
      "rule": "required"
    },
    {
      "name": "url",
      "tag": 2,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "title",
      "tag": 3,
      "type": "string",
      "rule": "optional"
    }
  ],
  "TechwolfButton": [
    {
      "name": "text",
      "tag": 1,
      "type": "string",
      "rule": "required"
    },
    {
      "name": "url",
      "tag": 2,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "templateId",
      "tag": 3,
      "type": "int32",
      "rule": "optional"
    }
  ],
  "TechwolfDialog": [
    {
      "name": "text",
      "tag": 1,
      "type": "string",
      "rule": "required"
    },
    {
      "name": "buttons",
      "tag": 2,
      "type": "TechwolfButton",
      "rule": "repeated"
    },
    {
      "name": "operated",
      "tag": 3,
      "type": "bool",
      "rule": "required"
    },
    {
      "name": "clickMore",
      "tag": 4,
      "type": "bool",
      "rule": "optional"
    },
    {
      "name": "type",
      "tag": 5,
      "type": "int32",
      "rule": "optional"
    },
    {
      "name": "backgroundUrl",
      "tag": 6,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "timeout",
      "tag": 7,
      "type": "int64",
      "rule": "optional"
    },
    {
      "name": "statisticParameters",
      "tag": 8,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "title",
      "tag": 9,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "url",
      "tag": 10,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "selectedIndex",
      "tag": 11,
      "type": "int32",
      "rule": "optional"
    },
    {
      "name": "extend",
      "tag": 12,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "content",
      "tag": 13,
      "type": "string",
      "rule": "optional"
    }
  ],
  "TechwolfJobDesc": [
    {
      "name": "title",
      "tag": 1,
      "type": "string",
      "rule": "required"
    },
    {
      "name": "company",
      "tag": 2,
      "type": "string",
      "rule": "required"
    },
    {
      "name": "salary",
      "tag": 3,
      "type": "string",
      "rule": "required"
    },
    {
      "name": "url",
      "tag": 4,
      "type": "string",
      "rule": "required"
    },
    {
      "name": "jobId",
      "tag": 5,
      "type": "int64",
      "rule": "required"
    },
    {
      "name": "positionCategory",
      "tag": 6,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "experience",
      "tag": 7,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "education",
      "tag": 8,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "city",
      "tag": 9,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "bossTitle",
      "tag": 10,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "boss",
      "tag": 11,
      "type": "TechwolfUser",
      "rule": "optional"
    },
    {
      "name": "lid",
      "tag": 12,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "stage",
      "tag": 13,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "bottomText",
      "tag": 14,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "jobLabel",
      "tag": 15,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "iconFlag",
      "tag": 16,
      "type": "int32",
      "rule": "optional"
    },
    {
      "name": "content",
      "tag": 17,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "labels",
      "tag": 18,
      "type": "string",
      "rule": "repeated"
    },
    {
      "name": "expectId",
      "tag": 19,
      "type": "int64",
      "rule": "optional"
    },
    {
      "name": "expectPosition",
      "tag": 20,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "expectSalary",
      "tag": 21,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "partTimeDesc",
      "tag": 22,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "geek",
      "tag": 23,
      "type": "TechwolfUser",
      "rule": "optional"
    },
    {
      "name": "latlon",
      "tag": 24,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "distance",
      "tag": 25,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "extend",
      "tag": 26,
      "type": "string",
      "rule": "optional"
    }
  ],
  "TechwolfResume": [
    {
      "name": "user",
      "tag": 1,
      "type": "TechwolfUser",
      "rule": "required"
    },
    {
      "name": "description",
      "tag": 2,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "city",
      "tag": 3,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "position",
      "tag": 4,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "keywords",
      "tag": 5,
      "type": "string",
      "rule": "repeated"
    },
    {
      "name": "expectId",
      "tag": 6,
      "type": "int64",
      "rule": "optional"
    },
    {
      "name": "lid",
      "tag": 7,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "gender",
      "tag": 8,
      "type": "int32",
      "rule": "optional"
    },
    {
      "name": "salary",
      "tag": 9,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "workYear",
      "tag": 10,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "content1",
      "tag": 11,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "content2",
      "tag": 12,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "education",
      "tag": 13,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "age",
      "tag": 14,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "labels",
      "tag": 15,
      "type": "string",
      "rule": "repeated"
    },
    {
      "name": "experiences",
      "tag": 16,
      "type": "UserExperience",
      "rule": "repeated"
    },
    {
      "name": "positionCategory",
      "tag": 17,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "jobSalary",
      "tag": 18,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "bottomText",
      "tag": 19,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "applyStatus",
      "tag": 20,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "jobId",
      "tag": 21,
      "type": "int64",
      "rule": "optional"
    },
    {
      "name": "content3",
      "tag": 22,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "securityId",
      "tag": 23,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "boss",
      "tag": 24,
      "type": "TechwolfUser",
      "rule": "optional"
    },
    {
      "name": "brandName",
      "tag": 25,
      "type": "string",
      "rule": "optional"
    }
  ],
  "TechwolfHyperLink": [
    {
      "name": "text",
      "tag": 1,
      "type": "string",
      "rule": "required"
    },
    {
      "name": "url",
      "tag": 2,
      "type": "string",
      "rule": "required"
    },
    {
      "name": "hyperLinkType",
      "tag": 3,
      "type": "int32",
      "rule": "required"
    },
    {
      "name": "extraJson",
      "tag": 4,
      "type": "string",
      "rule": "optional"
    }
  ],
  "TechwolfMessageBody": [
    {
      "name": "type",
      "tag": 1,
      "type": "int32",
      "rule": "required"
    },
    {
      "name": "templateId",
      "tag": 2,
      "type": "int32",
      "rule": "required"
    },
    {
      "name": "headTitle",
      "tag": 11,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "text",
      "tag": 3,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "sound",
      "tag": 4,
      "type": "TechwolfSound",
      "rule": "optional"
    },
    {
      "name": "image",
      "tag": 5,
      "type": "TechwolfImage",
      "rule": "optional"
    },
    {
      "name": "action",
      "tag": 6,
      "type": "TechwolfAction",
      "rule": "optional"
    },
    {
      "name": "articles",
      "tag": 7,
      "type": "TechwolfArticle",
      "rule": "repeated"
    },
    {
      "name": "notify",
      "tag": 8,
      "type": "TechwolfNotify",
      "rule": "optional"
    },
    {
      "name": "dialog",
      "tag": 9,
      "type": "TechwolfDialog",
      "rule": "optional"
    },
    {
      "name": "jobDesc",
      "tag": 10,
      "type": "TechwolfJobDesc",
      "rule": "optional"
    },
    {
      "name": "resume",
      "tag": 12,
      "type": "TechwolfResume",
      "rule": "optional"
    },
    {
      "name": "redEnvelope",
      "tag": 13,
      "type": "TechwolfRedEnvelope",
      "rule": "optional"
    },
    {
      "name": "orderDetail",
      "tag": 14,
      "type": "TechwolfOrderDetail",
      "rule": "optional"
    },
    {
      "name": "hyperLink",
      "tag": 15,
      "type": "TechwolfHyperLink",
      "rule": "optional"
    },
    {
      "name": "video",
      "tag": 16,
      "type": "TechwolfVideo",
      "rule": "optional"
    },
    {
      "name": "interview",
      "tag": 17,
      "type": "TechwolfInterview",
      "rule": "optional"
    },
    {
      "name": "jobShare",
      "tag": 18,
      "type": "TechwolfJobShare",
      "rule": "optional"
    },
    {
      "name": "resumeShare",
      "tag": 19,
      "type": "TechwolfResumeShare",
      "rule": "optional"
    },
    {
      "name": "atInfo",
      "tag": 20,
      "type": "AtInfo",
      "rule": "optional"
    },
    {
      "name": "sticker",
      "tag": 21,
      "type": "TechwolfSticker",
      "rule": "optional"
    },
    {
      "name": "chatShare",
      "tag": 22,
      "type": "TechwolfChatShare",
      "rule": "optional"
    },
    {
      "name": "interviewShare",
      "tag": 23,
      "type": "TechwolfInterviewShare",
      "rule": "optional"
    },
    {
      "name": "listCard",
      "tag": 24,
      "type": "TechwolfListCard",
      "rule": "optional"
    },
    {
      "name": "starRate",
      "tag": 25,
      "type": "TechwolfStarRate",
      "rule": "optional"
    },
    {
      "name": "frame",
      "tag": 26,
      "type": "TechwolfFrame",
      "rule": "optional"
    },
    {
      "name": "multiImage",
      "tag": 27,
      "type": "TechwolfMultiImage",
      "rule": "optional"
    },
    {
      "name": "extend",
      "tag": 28,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "style",
      "tag": 29,
      "type": "int32",
      "rule": "optional"
    },
    {
      "name": "comDesc",
      "tag": 30,
      "type": "TechwolfComDesc",
      "rule": "optional"
    }
  ],
  "TechwolfMessage": [
    {
      "name": "from",
      "tag": 1,
      "type": "TechwolfUser",
      "rule": "required"
    },
    {
      "name": "to",
      "tag": 2,
      "type": "TechwolfUser",
      "rule": "required"
    },
    {
      "name": "type",
      "tag": 3,
      "type": "int32",
      "rule": "required"
    },
    {
      "name": "mid",
      "tag": 4,
      "type": "int64",
      "rule": "optional"
    },
    {
      "name": "time",
      "tag": 5,
      "type": "int64",
      "rule": "optional"
    },
    {
      "name": "body",
      "tag": 6,
      "type": "TechwolfMessageBody",
      "rule": "required"
    },
    {
      "name": "offline",
      "tag": 7,
      "type": "bool",
      "rule": "optional"
    },
    {
      "name": "received",
      "tag": 8,
      "type": "bool",
      "rule": "optional"
    },
    {
      "name": "pushText",
      "tag": 9,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "taskId",
      "tag": 10,
      "type": "int64",
      "rule": "optional"
    },
    {
      "name": "cmid",
      "tag": 11,
      "type": "int64",
      "rule": "optional"
    },
    {
      "name": "status",
      "tag": 12,
      "type": "int32",
      "rule": "optional"
    },
    {
      "name": "uncount",
      "tag": 13,
      "type": "int32",
      "rule": "optional"
    },
    {
      "name": "pushSound",
      "tag": 14,
      "type": "int32",
      "rule": "optional"
    },
    {
      "name": "flag",
      "tag": 15,
      "type": "int32",
      "rule": "optional"
    },
    {
      "name": "encryptedBody",
      "tag": 16,
      "type": "bytes",
      "rule": "optional"
    },
    {
      "name": "bizId",
      "tag": 17,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "bizType",
      "tag": 18,
      "type": "int32",
      "rule": "optional"
    },
    {
      "name": "securityId",
      "tag": 19,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "quoteId",
      "tag": 20,
      "type": "int64",
      "rule": "optional"
    }
  ],
  "TechwolfClientInfo": [
    {
      "name": "version",
      "tag": 1,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "system",
      "tag": 2,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "systemVersion",
      "tag": 3,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "model",
      "tag": 4,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "uniqid",
      "tag": 5,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "network",
      "tag": 6,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "appid",
      "tag": 7,
      "type": "int32",
      "rule": "optional"
    },
    {
      "name": "platform",
      "tag": 8,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "channel",
      "tag": 9,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "ssid",
      "tag": 10,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "bssid",
      "tag": 11,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "longitude",
      "tag": 12,
      "type": "double",
      "rule": "optional"
    },
    {
      "name": "latitude",
      "tag": 13,
      "type": "double",
      "rule": "optional"
    }
  ],
  "TechwolfClientTime": [
    {
      "name": "startTime",
      "tag": 1,
      "type": "int64",
      "rule": "optional"
    },
    {
      "name": "resumeTime",
      "tag": 2,
      "type": "int64",
      "rule": "optional"
    },
    {
      "name": "locateTime",
      "tag": 3,
      "type": "int64",
      "rule": "optional"
    }
  ],
  "TechwolfPresence": [
    {
      "name": "type",
      "tag": 1,
      "type": "int32",
      "rule": "required"
    },
    {
      "name": "uid",
      "tag": 2,
      "type": "int32",
      "rule": "required"
    },
    {
      "name": "clientInfo",
      "tag": 3,
      "type": "TechwolfClientInfo",
      "rule": "optional"
    },
    {
      "name": "clientTime",
      "tag": 4,
      "type": "TechwolfClientTime",
      "rule": "optional"
    },
    {
      "name": "lastMessageId",
      "tag": 5,
      "type": "int64",
      "rule": "optional"
    },
    {
      "name": "lastGroupMessageId",
      "tag": 6,
      "type": "int64",
      "rule": "optional"
    },
    {
      "name": "userId",
      "tag": 7,
      "type": "int64",
      "rule": "optional"
    }
  ],
  "TechwolfKVEntry": [
    {
      "name": "key",
      "tag": 1,
      "type": "string",
      "rule": "required"
    },
    {
      "name": "value",
      "tag": 2,
      "type": "string",
      "rule": "required"
    }
  ],
  "TechwolfIq": [
    {
      "name": "qid",
      "tag": 1,
      "type": "int64",
      "rule": "required"
    },
    {
      "name": "query",
      "tag": 2,
      "type": "string",
      "rule": "required"
    },
    {
      "name": "params",
      "tag": 3,
      "type": "TechwolfKVEntry",
      "rule": "repeated"
    }
  ],
  "TechwolfIqResponse": [
    {
      "name": "qid",
      "tag": 1,
      "type": "int64",
      "rule": "required"
    },
    {
      "name": "query",
      "tag": 2,
      "type": "string",
      "rule": "required"
    },
    {
      "name": "results",
      "tag": 3,
      "type": "TechwolfKVEntry",
      "rule": "repeated"
    }
  ],
  "TechwolfMessageSync": [
    {
      "name": "clientMid",
      "tag": 1,
      "type": "int64",
      "rule": "required"
    },
    {
      "name": "serverMid",
      "tag": 2,
      "type": "int64",
      "rule": "required"
    }
  ],
  "TechwolfMessageRead": [
    {
      "name": "userId",
      "tag": 1,
      "type": "int64",
      "rule": "required"
    },
    {
      "name": "messageId",
      "tag": 2,
      "type": "int64",
      "rule": "required"
    },
    {
      "name": "readTime",
      "tag": 3,
      "type": "int64",
      "rule": "required"
    },
    {
      "name": "sync",
      "tag": 4,
      "type": "bool",
      "rule": "optional",
      "defaultValue": false
    },
    {
      "name": "userSource",
      "tag": 5,
      "type": "int32",
      "rule": "optional"
    }
  ],
  "TechwolfChatProtocol": [
    {
      "name": "type",
      "tag": 1,
      "type": "int32",
      "rule": "required"
    },
    {
      "name": "version",
      "tag": 2,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "messages",
      "tag": 3,
      "type": "TechwolfMessage",
      "rule": "repeated"
    },
    {
      "name": "presence",
      "tag": 4,
      "type": "TechwolfPresence",
      "rule": "optional"
    },
    {
      "name": "iq",
      "tag": 5,
      "type": "TechwolfIq",
      "rule": "optional"
    },
    {
      "name": "iqResponse",
      "tag": 6,
      "type": "TechwolfIqResponse",
      "rule": "optional"
    },
    {
      "name": "messageSync",
      "tag": 7,
      "type": "TechwolfMessageSync",
      "rule": "repeated"
    },
    {
      "name": "messageRead",
      "tag": 8,
      "type": "TechwolfMessageRead",
      "rule": "repeated"
    },
    {
      "name": "dataSync",
      "tag": 9,
      "type": "TechwolfDataSync",
      "rule": "optional"
    },
    {
      "name": "domain",
      "tag": 10,
      "type": "int32",
      "rule": "optional"
    }
  ],
  "TechwolfRedEnvelope": [
    {
      "name": "redId",
      "tag": 1,
      "type": "int64",
      "rule": "required"
    },
    {
      "name": "redText",
      "tag": 2,
      "type": "string",
      "rule": "required"
    },
    {
      "name": "redTitle",
      "tag": 3,
      "type": "string",
      "rule": "required"
    },
    {
      "name": "clickUrl",
      "tag": 4,
      "type": "string",
      "rule": "required"
    }
  ],
  "TechwolfOrderDetail": [
    {
      "name": "title",
      "tag": 1,
      "type": "string",
      "rule": "required"
    },
    {
      "name": "subTitle",
      "tag": 2,
      "type": "string",
      "rule": "required"
    },
    {
      "name": "url",
      "tag": 3,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "orderDetailEntryList",
      "tag": 4,
      "type": "TechwolfOrderDetailEntry",
      "rule": "repeated"
    }
  ],
  "TechwolfOrderDetailItem": [
    {
      "name": "name",
      "tag": 1,
      "type": "string",
      "rule": "required"
    },
    {
      "name": "templateId",
      "tag": 2,
      "type": "int32",
      "rule": "required"
    }
  ],
  "TechwolfOrderDetailEntry": [
    {
      "name": "key",
      "tag": 1,
      "type": "TechwolfOrderDetailItem",
      "rule": "required"
    },
    {
      "name": "value",
      "tag": 2,
      "type": "TechwolfOrderDetailItem",
      "rule": "required"
    }
  ],
  "TechwolfUserSync": [
    {
      "name": "uid",
      "tag": 1,
      "type": "int64",
      "rule": "required"
    },
    {
      "name": "identity",
      "tag": 2,
      "type": "int32",
      "rule": "required"
    },
    {
      "name": "extraJson",
      "tag": 3,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "userSource",
      "tag": 4,
      "type": "int32",
      "rule": "optional"
    }
  ],
  "TechwolfDataSync": [
    {
      "name": "type",
      "tag": 1,
      "type": "int32",
      "rule": "required"
    },
    {
      "name": "userSync",
      "tag": 2,
      "type": "TechwolfUserSync",
      "rule": "optional"
    },
    {
      "name": "groupSync",
      "tag": 3,
      "type": "TechwolfGroupSync",
      "rule": "optional"
    }
  ],
  "TechwolfSlice": [
    {
      "name": "startIndex",
      "tag": 1,
      "type": "int32",
      "rule": "required"
    },
    {
      "name": "endIndex",
      "tag": 2,
      "type": "int32",
      "rule": "required"
    }
  ],
  "UserExperience": [
    {
      "name": "organization",
      "tag": 1,
      "type": "string",
      "rule": "required"
    },
    {
      "name": "occupation",
      "tag": 2,
      "type": "string",
      "rule": "required"
    },
    {
      "name": "startDate",
      "tag": 3,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "endDate",
      "tag": 4,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "type",
      "tag": 5,
      "type": "int32",
      "rule": "required"
    }
  ],
  "TechwolfJobShare": [
    {
      "name": "user",
      "tag": 1,
      "type": "TechwolfUser",
      "rule": "required"
    },
    {
      "name": "jobId",
      "tag": 2,
      "type": "int64",
      "rule": "required"
    },
    {
      "name": "position",
      "tag": 3,
      "type": "string",
      "rule": "required"
    },
    {
      "name": "salary",
      "tag": 4,
      "type": "string",
      "rule": "required"
    },
    {
      "name": "location",
      "tag": 5,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "company",
      "tag": 6,
      "type": "string",
      "rule": "required"
    },
    {
      "name": "stage",
      "tag": 7,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "experience",
      "tag": 8,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "education",
      "tag": 9,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "url",
      "tag": 10,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "lid",
      "tag": 11,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "price",
      "tag": 12,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "description",
      "tag": 13,
      "type": "string",
      "rule": "optional"
    }
  ],
  "TechwolfResumeShare": [
    {
      "name": "user",
      "tag": 1,
      "type": "TechwolfUser",
      "rule": "required"
    },
    {
      "name": "expectId",
      "tag": 2,
      "type": "int64",
      "rule": "required"
    },
    {
      "name": "position",
      "tag": 3,
      "type": "string",
      "rule": "required"
    },
    {
      "name": "salary",
      "tag": 4,
      "type": "string",
      "rule": "required"
    },
    {
      "name": "location",
      "tag": 5,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "applyStatus",
      "tag": 6,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "age",
      "tag": 7,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "experience",
      "tag": 8,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "education",
      "tag": 9,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "url",
      "tag": 10,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "lid",
      "tag": 11,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "gender",
      "tag": 12,
      "type": "int32",
      "rule": "optional"
    },
    {
      "name": "blurred",
      "tag": 13,
      "type": "bool",
      "rule": "optional"
    },
    {
      "name": "source",
      "tag": 14,
      "type": "int32",
      "rule": "optional"
    }
  ],
  "AtInfo": [
    {
      "name": "flag",
      "tag": 1,
      "type": "int32",
      "rule": "required"
    },
    {
      "name": "uids",
      "tag": 2,
      "type": "int64",
      "rule": "repeated"
    }
  ],
  "TechwolfGroupSync": [
    {
      "name": "gid",
      "tag": 1,
      "type": "int64",
      "rule": "required"
    },
    {
      "name": "version",
      "tag": 2,
      "type": "int32",
      "rule": "optional"
    },
    {
      "name": "encGid",
      "tag": 3,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "extraJson",
      "tag": 4,
      "type": "string",
      "rule": "optional"
    }
  ],
  "TechwolfSticker": [
    {
      "name": "sid",
      "tag": 1,
      "type": "int64",
      "rule": "required"
    },
    {
      "name": "packId",
      "tag": 2,
      "type": "int64",
      "rule": "optional"
    },
    {
      "name": "image",
      "tag": 3,
      "type": "TechwolfImage",
      "rule": "optional"
    },
    {
      "name": "format",
      "tag": 4,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "name",
      "tag": 5,
      "type": "string",
      "rule": "optional"
    }
  ],
  "TechwolfChatShare": [
    {
      "name": "shareId",
      "tag": 1,
      "type": "int64",
      "rule": "required"
    },
    {
      "name": "title",
      "tag": 2,
      "type": "string",
      "rule": "required"
    },
    {
      "name": "records",
      "tag": 3,
      "type": "string",
      "rule": "repeated"
    },
    {
      "name": "bottomText",
      "tag": 4,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "url",
      "tag": 5,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "from",
      "tag": 6,
      "type": "TechwolfUser",
      "rule": "required"
    },
    {
      "name": "to",
      "tag": 7,
      "type": "TechwolfUser",
      "rule": "required"
    },
    {
      "name": "user",
      "tag": 8,
      "type": "TechwolfUser",
      "rule": "required"
    }
  ],
  "TechwolfInterviewShare": [
    {
      "name": "interviewId",
      "tag": 1,
      "type": "int64",
      "rule": "required"
    },
    {
      "name": "user",
      "tag": 2,
      "type": "TechwolfUser",
      "rule": "required"
    },
    {
      "name": "title",
      "tag": 3,
      "type": "string",
      "rule": "required"
    },
    {
      "name": "bottomText",
      "tag": 4,
      "type": "string",
      "rule": "required"
    },
    {
      "name": "url",
      "tag": 5,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "interviewTime",
      "tag": 6,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "interviewAddress",
      "tag": 7,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "jobName",
      "tag": 8,
      "type": "string",
      "rule": "optional"
    }
  ],
  "TechwolfListItem": [
    {
      "name": "title",
      "tag": 1,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "icon",
      "tag": 2,
      "type": "int32",
      "rule": "optional"
    },
    {
      "name": "url",
      "tag": 3,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "text",
      "tag": 4,
      "type": "string",
      "rule": "optional"
    }
  ],
  "TechwolfListCard": [
    {
      "name": "title",
      "tag": 1,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "items",
      "tag": 2,
      "type": "TechwolfListItem",
      "rule": "repeated"
    },
    {
      "name": "pageSize",
      "tag": 3,
      "type": "int32",
      "rule": "optional"
    },
    {
      "name": "extend",
      "tag": 4,
      "type": "string",
      "rule": "optional"
    }
  ],
  "TechwolfStar": [
    {
      "name": "starId",
      "tag": 1,
      "type": "int64",
      "rule": "required"
    },
    {
      "name": "starDesc",
      "tag": 2,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "options",
      "tag": 3,
      "type": "TechwolfListItem",
      "rule": "repeated"
    }
  ],
  "TechwolfStarRate": [
    {
      "name": "title",
      "tag": 1,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "stars",
      "tag": 2,
      "type": "TechwolfStar",
      "rule": "repeated"
    },
    {
      "name": "rateStatus",
      "tag": 3,
      "type": "int32",
      "rule": "required"
    },
    {
      "name": "rateStar",
      "tag": 4,
      "type": "TechwolfStar",
      "rule": "optional"
    },
    {
      "name": "submitButton",
      "tag": 5,
      "type": "TechwolfButton",
      "rule": "optional"
    }
  ],
  "TechwolfFrame": [
    {
      "name": "href",
      "tag": 1,
      "type": "string",
      "rule": "required"
    }
  ],
  "TechwolfMultiImage": [
    {
      "name": "images",
      "tag": 1,
      "type": "TechwolfImageInfo",
      "rule": "repeated"
    }
  ],
  "TechwolfComDesc": [
    {
      "name": "picUrl",
      "tag": 1,
      "type": "string",
      "rule": "required"
    },
    {
      "name": "name",
      "tag": 2,
      "type": "string",
      "rule": "required"
    },
    {
      "name": "stage",
      "tag": 3,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "scale",
      "tag": 4,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "industry",
      "tag": 5,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "welfareLabels",
      "tag": 6,
      "type": "string",
      "rule": "repeated"
    },
    {
      "name": "introduce",
      "tag": 7,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "url",
      "tag": 8,
      "type": "string",
      "rule": "optional"
    },
    {
      "name": "extend",
      "tag": 9,
      "type": "string",
      "rule": "optional"
    }
  ]
};
// SCHEMA_GENERATED_END
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const MAX_UINT64 = (1n << 64n) - 1n;
const MIN_INT64 = -(1n << 63n);
const MAX_INT64 = (1n << 63n) - 1n;

export function bossInteger(value: BossId): bigint {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new BossProtocolError('An integer ID must be a safe Number, decimal string, or bigint');
    return BigInt(value);
  }
  if (typeof value === 'bigint') return value;
  if (typeof value !== 'string' || !/^-?\d+$/.test(value)) throw new BossProtocolError('Invalid decimal integer');
  return BigInt(value);
}
export function bossId(value: BossId, allowZero = false): string {
  const n = bossInteger(value);
  if (n < (allowZero ? 0n : 1n) || n > MAX_UINT64) throw new BossProtocolError('ID outside the allowed unsigned 64-bit range');
  return n.toString();
}
function concatenate(parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
function varint(value: bigint): Uint8Array {
  if (value < 0n || value > MAX_UINT64) throw new BossProtocolError('Varint outside uint64 range');
  const out: number[] = [];
  do { let byte = Number(value & 127n); value >>= 7n; if (value) byte |= 128; out.push(byte); } while (value);
  return Uint8Array.from(out);
}
function readVarint(bytes: Uint8Array, offset: number): { value: bigint; next: number } {
  let value = 0n;
  for (let i = 0; i < 10; i++) {
    const byte = bytes[offset++];
    if (byte === undefined) throw new BossProtocolError('Truncated protobuf varint');
    if (i === 9 && byte > 1) throw new BossProtocolError('Protobuf varint exceeds uint64');
    value |= BigInt(byte & 127) << BigInt(7 * i);
    if (!(byte & 128)) return { value, next: offset };
  }
  throw new BossProtocolError('Invalid protobuf varint');
}
function wireType(type: string): number {
  if (type === 'int32' || type === 'int64' || type === 'bool') return 0;
  if (type === 'double') return 1;
  if (type === 'string' || type === 'bytes' || SCHEMA[type]) return 2;
  throw new BossProtocolError(`Unsupported protobuf field type ${type}`);
}
function signed(value: unknown, bits: 32 | 64): bigint {
  if (typeof value !== 'string' && typeof value !== 'bigint' && typeof value !== 'number') throw new BossProtocolError('Invalid integer value');
  const n = bossInteger(value);
  const min = bits === 32 ? -2147483648n : MIN_INT64;
  const max = bits === 32 ? 2147483647n : MAX_INT64;
  if (n < min || n > max) throw new BossProtocolError(`Integer outside int${bits} range`);
  return BigInt.asUintN(64, n);
}
function encodeValue(field: ProtoField, value: unknown, depth: number): Uint8Array {
  switch (field.type) {
    case 'int32': return varint(signed(value, 32));
    case 'int64': return varint(signed(value, 64));
    case 'bool':
      if (typeof value !== 'boolean') throw new BossProtocolError(`Expected bool for ${field.name}`);
      return varint(value ? 1n : 0n);
    case 'double': {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new BossProtocolError(`Expected double for ${field.name}`);
      const bytes = new Uint8Array(8); new DataView(bytes.buffer).setFloat64(0, value, true); return bytes;
    }
    default: {
      let bytes: Uint8Array;
      if (field.type === 'string') {
        if (typeof value !== 'string') throw new BossProtocolError(`Expected string for ${field.name}`);
        bytes = encoder.encode(value);
      } else if (field.type === 'bytes') {
        if (!(value instanceof Uint8Array)) throw new BossProtocolError(`Expected Uint8Array for ${field.name}`);
        bytes = value;
      } else {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BossProtocolError(`Expected message for ${field.name}`);
        bytes = encodeMessage(field.type, value as Record<string, unknown>, depth + 1);
      }
      return concatenate([varint(BigInt(bytes.length)), bytes]);
    }
  }
}
function encodeMessage(type: string, message: Record<string, unknown>, depth: number): Uint8Array {
  if (depth > 64) throw new BossProtocolError('Protobuf message nesting exceeds limit');
  const fields = SCHEMA[type];
  if (!fields) throw new BossProtocolError(`Unknown protobuf message ${type}`);
  const parts: Uint8Array[] = [];
  for (const field of fields) {
    const value = message[field.name];
    if (value === undefined || value === null) {
      if (field.rule === 'required') throw new BossProtocolError(`Missing required ${type}.${field.name}`);
      continue;
    }
    if (field.rule === 'repeated' && !Array.isArray(value)) throw new BossProtocolError(`Expected array for ${type}.${field.name}`);
    for (const item of field.rule === 'repeated' ? value as unknown[] : [value]) {
      parts.push(varint(BigInt(field.tag * 8 + wireType(field.type))), encodeValue(field, item, depth));
    }
  }
  const unknownFields = message.$unknownFields;
  if (Array.isArray(unknownFields)) for (const item of unknownFields) {
    if (item && typeof item === 'object' && (item as BossUnknownField).bytes instanceof Uint8Array) parts.push((item as BossUnknownField).bytes);
  }
  return concatenate(parts);
}
function decodeMessage(type: string, bytes: Uint8Array, depth: number): Record<string, unknown> {
  if (depth > 64) throw new BossProtocolError('Protobuf message nesting exceeds limit');
  const fields = SCHEMA[type];
  if (!fields) throw new BossProtocolError(`Unknown protobuf message ${type}`);
  const byTag = new Map(fields.map(field => [field.tag, field]));
  const out: Record<string, unknown> = {};
  const seen = new Set<string>();
  for (const field of fields) {
    if (field.rule === 'repeated') out[field.name] = [];
    else if ('defaultValue' in field) out[field.name] = field.defaultValue;
  }
  let offset = 0;
  const unknown: BossUnknownField[] = [];
  while (offset < bytes.length) {
    const start = offset, key = readVarint(bytes, offset); offset = key.next;
    if (key.value > 0xffffffffn) throw new BossProtocolError('Protobuf field key exceeds range');
    const tag = Number(key.value >> 3n), wire = Number(key.value & 7n);
    if (!tag) throw new BossProtocolError('Protobuf field tag cannot be zero');
    let raw: bigint | Uint8Array;
    if (wire === 0) { const r = readVarint(bytes, offset); raw = r.value; offset = r.next; }
    else if (wire === 1 || wire === 5) {
      const end = offset + (wire === 1 ? 8 : 4);
      if (end > bytes.length) throw new BossProtocolError('Truncated fixed protobuf field');
      raw = bytes.subarray(offset, end); offset = end;
    } else if (wire === 2) {
      const r = readVarint(bytes, offset);
      if (r.value > BigInt(bytes.length)) throw new BossProtocolError('Invalid protobuf field length');
      const end = r.next + Number(r.value);
      if (end > bytes.length) throw new BossProtocolError('Truncated protobuf field');
      raw = bytes.subarray(r.next, end); offset = end;
    } else throw new BossProtocolError(`Unsupported protobuf wire type ${wire}`);
    const field = byTag.get(tag);
    if (!field) { unknown.push({ tag, wireType: wire, bytes: bytes.slice(start, offset) }); continue; }
    if (wire !== wireType(field.type)) throw new BossProtocolError(`Wire type mismatch for ${type}.${field.name}`);
    let value: unknown;
    if (typeof raw === 'bigint') {
      value = field.type === 'int64' ? BigInt.asIntN(64, raw).toString() : field.type === 'bool' ? raw !== 0n : Number(BigInt.asIntN(32, raw));
    } else if (field.type === 'double') value = new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getFloat64(0, true);
    else if (field.type === 'string') value = decoder.decode(raw);
    else if (field.type === 'bytes') value = raw.slice();
    else value = decodeMessage(field.type, raw, depth + 1);
    if (field.rule === 'repeated') (out[field.name] as unknown[]).push(value);
    else out[field.name] = value;
    seen.add(field.name);
  }
  for (const field of fields) if (field.rule === 'required' && !seen.has(field.name)) throw new BossProtocolError(`Missing required ${type}.${field.name}`);
  if (unknown.length) out.$unknownFields = unknown;
  return out;
}
export function encodeBossProtocol(protocol: BossChatProtocol): Uint8Array {
  return encodeMessage('TechwolfChatProtocol', protocol, 0);
}
export function decodeBossProtocol(bytes: Uint8Array): BossChatProtocol {
  return decodeMessage('TechwolfChatProtocol', bytes, 0) as BossChatProtocol;
}
export interface BossTextInput {
  from: BossId; to: BossId; cmid: BossId; text: string; time: BossId; friendSource?: number; encryptUid?: string;
}
/** Outbound active factory: deliberately does not invent jobId/securityId/biz metadata. */
export function createBossTextProtocol(input: BossTextInput): BossChatProtocol {
  const cmid = bossId(input.cmid), from = bossId(input.from), to = bossId(input.to);
  const recipient: BossUser = { uid: to, source: input.friendSource ?? 0 };
  if (input.encryptUid) recipient.name = input.encryptUid;
  return { type: 1, messages: [{ from: { uid: from, source: 0 }, to: recipient, type: 1, mid: cmid, cmid, time: bossId(input.time, true), body: { type: 1, templateId: 1, text: input.text }, status: 0 }] };
}
export function createBossReadProtocol(input: { userId: BossId; messageId: BossId; readTime: BossId; userSource?: number }): BossChatProtocol {
  return { type: 6, messageRead: [{ userId: bossId(input.userId), messageId: bossId(input.messageId), readTime: bossId(input.readTime, true), userSource: input.userSource ?? 0 }] };
}
export function createBossPresenceProtocol(userId: BossId, lastMessageId: BossId = '0'): BossChatProtocol {
  const uid = bossInteger(userId);
  // Presence.uid is int32 in the actual schema, unlike TechwolfUser.uid.
  if (uid <= 0n || uid > 2147483647n) throw new BossProtocolError('Presence.uid must fit positive int32; it must not be truncated');
  return { type: 2, presence: { type: 1, uid: Number(uid), lastMessageId: bossId(lastMessageId, true), clientInfo: { version: '4.92', system: '', systemVersion: '', model: '', uniqid: '', network: '', appid: 20002, platform: 'h5', channel: '-1', ssid: '', bssid: '', longitude: 0, latitude: 0 } } };
}
