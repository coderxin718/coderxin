# InfiniteChat（千言）—— 从零构建的实时聊天微服务平台

## 项目简介

**千言**（InfiniteChat）是一个功能完备的实时聊天应用后端，采用 **Java 微服务架构** 从零构建。项目涵盖了即时通讯（IM）的核心业务场景——单聊消息、群组聊天、朋友圈、红包、离线消息推送等，并在此基础上实现了分布式服务治理、异步消息队列、WebSocket 长连接管理等工程化实践。

> 项目命名「千言」，取意「千言万语」，希望用户能在这里畅所欲言。

---

## 技术栈

| 层次 | 技术选型 |
|------|----------|
| **基础框架** | Spring Boot 2.6.13 |
| **微服务治理** | Spring Cloud Alibaba + Nacos（服务注册/发现） |
| **API 网关** | Spring Cloud Gateway |
| **实时通信** | Netty WebSocket（自定义协议） |
| **异步消息** | Apache Kafka |
| **数据持久化** | MySQL + MyBatis-Plus |
| **缓存与会话** | Redis |
| **对象存储** | MinIO |
| **身份认证** | JWT（jjwt 0.9.1） |
| **服务间调用** | OpenFeign + OkHttp |
| **容器化部署** | Docker + Docker Compose |
| **语言版本** | Java 8 |

---

## 架构设计

整个系统由 **7 个独立微服务** 组成，通过 Nacos 进行统一的服务注册与发现，Spring Cloud Gateway 作为唯一入口网关对外暴露 API。

```
                    ┌─────────────────────────────────┐
                    │        Spring Cloud Gateway      │
                    │           (Port 10010)           │
                    └───────┬─────────┬───────────────┘
                            │         │
              ┌─────────────┼─────────┼──────────────┐
              │             │         │              │
              ▼             ▼         ▼              ▼
     ┌────────────┐ ┌──────────┐ ┌────────┐ ┌────────────┐
     │   Auth     │ │  Message │ │ Moment │ │  Contact   │
     │  Service   │ │  Service │ │Service │ │  Service   │
     │  :8082     │ │  :8081   │ │ :8086  │ │   :8084    │
     └─────┬──────┘ └────┬─────┘ └───┬────┘ └─────┬──────┘
           │             │           │             │
           │    ┌────────┼─────┐     │             │
           │    │        │     │     │             │
           ▼    ▼        ▼     ▼     ▼             ▼
     ┌──────────────────────────────────────────────────┐
     │              MySQL / Redis / MinIO               │
     └──────────────────────────────────────────────────┘

     ┌──────────────┐    ┌────────────────────┐
     │  Kafka       │◄───│  MessagingService  │
     │  Broker      │    │  (Producer)         │
     └──────┬───────┘    └────────────────────┘
            │
            ▼
     ┌──────────────┐    ┌──────────────────────────────┐
     │  OfflineData │    │  RealTimeCommunicationService │
     │  StoreService│    │  HTTP :8083 + Netty :9000     │
     │   :8085      │    │  (WebSocket 长连接)            │
     └──────────────┘    └──────────────────────────────┘
```

### 服务职责一览

| 服务名称 | 端口 | 核心职责 |
|----------|------|----------|
| **GateWay** | 10010 | 统一入口、路由转发、CORS、负载均衡 |
| **AuthenticationService** | 8082 | 短信验证码登录/注册、JWT 签发、头像上传 |
| **RealTimeCommunicationService** | 8083 / 9000 | WebSocket 长连接管理、心跳检测、消息推送、ACK 确认 |
| **MessagingService** | 8081 | 收发消息、会话管理、红包收发、Kafka 消息生产 |
| **OfflineDataStoreService** | 8085 | Kafka 消息消费、离线消息持久化与查询 |
| **MomentService** | 8086 | 朋友圈动态发布/删除、点赞、评论、图片上传 |
| **ContanctService** | 8084 | 好友管理（增删/拉黑/申请）、群组管理（创建/踢人/退出）、用户搜索 |

---

## 核心功能

### 1. 用户认证体系
- **短信验证码登录**：集成阿里云短信服务，手机号 + 验证码一键登录/注册
- **JWT 无状态认证**：登录后签发 JWT Token，后续请求通过 Authorization 头携带
- **网关来源校验**：通过自定义 `SourceHandler` 拦截器，确保所有请求经由 Gateway 进入，防止绕过网关的恶意请求

### 2. 实时消息通信
- **Netty WebSocket 长连接**：基于 Netty 框架自建 WebSocket 服务，支持高并发长连接
- **自定义应用层协议**：定义了 ACK 确认、心跳保活、消息推送等多种消息类型
- **心跳检测**：5 分钟读超时自动断开僵尸连接
- **消息确认机制**：客户端收到消息后回传 ACK，保证消息可靠送达
- **用户通道映射**：Redis + 内存双重维护用户与 Netty Channel 的映射关系，实现精准推送

### 3. 消息业务
- **单聊与群聊**：支持文本、图片、文件、视频、表情、红包等多种消息类型
- **会话列表**：维护用户会话，展示最近消息与未读计数
- **红包功能**：发红包（随机金额分配）、抢红包、查询红包详情
- **离线消息**：通过 Kafka 异步将消息投递至离线存储服务，用户上线后拉取未读消息

### 4. 联系人 & 社交
- **好友管理**：搜索用户、发送好友申请、审批、拉黑/删除
- **群组管理**：创建群聊、邀请成员、踢人、退出群组
- **朋友圈**：发布图文动态、点赞、评论，图片存储于 MinIO 对象存储

---

## 技术亮点

### 1. Netty 自定义 WebSocket 协议

没有使用现成的 WebSocket 框架（如 Socket.IO），而是基于 Netty 直接打造了一套完整的实时通信层：

- **Pipeline 设计**：`IdleStateHandler → HttpServerCodec → ChunkedWriteHandler → HttpObjectAggregator → 自定义认证处理器 → WebSocket 协议处理器 → 业务消息处理器`
- **握手阶段认证**：在 HTTP 升级为 WebSocket 的握手阶段，从请求头中提取并验证 JWT Token，非法连接直接拒绝
- **独立 Nacos 注册**：Netty 服务以独立名称 `NettyService` 注册到 Nacos，网关通过 `lb:ws://` 协议路由 WebSocket 请求

### 2. 消息异步解耦

引入 **Kafka** 作为消息中间件，实现消息发送与持久化的解耦：

```
用户发送消息 → MessagingService（生产）→ Kafka → OfflineDataStoreService（消费）→ MySQL
                  │
                  └──→ Netty WebSocket（实时推送给在线用户）
```

这种设计将消息的"实时推送"与"持久化存储"两个关注点分离，降低了耦合度，也提升了系统的吞吐能力。

### 3. 分布式下的消息精准推送

当用户连接在某一台 Netty 实例上时，其他服务如何将消息准确推送到该用户？

- Redis 中维护 `user:session:{userId}` 键，存储用户当前连接的 Netty 服务器 IP
- MessagingService 通过 `DiscoveryClient` 获取 Netty 服务实例列表，结合 Redis 中的 IP 信息，直接向目标 Netty 实例发起 HTTP POST，由 Netty 实例完成最终的 WebSocket 推送

### 4. 多级防重复提交

在红包等关键业务中，通过自定义 `@PreventDuplicateSubmit` 注解 + AOP 切面实现防重复提交，防止用户短时间内重复发起相同的请求。

---

## 部署架构

所有服务通过 Docker Compose 一键部署：

```yaml
# 内存分配
AuthenticationService:   512M
MessagingService:        512M
RealTimeCommunicationService: 1024M  # Netty 需要更大内存
OfflineDataStoreService: 512M
MomentService:           512M
ContanctService:         512M
GateWay:                 512M
```

基础设施依赖：
- **Nacos**：服务注册中心
- **MySQL**：业务数据存储
- **Redis**：缓存与会话管理
- **Kafka**：异步消息队列
- **MinIO**：图片/文件对象存储

---

## 项目收获

这个项目是一个较为完整的微服务实践，从架构设计到编码落地覆盖了后端开发的核心技术栈。通过它我深入理解了：

1. **微服务拆分原则**——如何按业务边界划分服务、定义服务间通信方式
2. **Netty 网络编程**——从 Channel Pipeline 到自定义协议的完整链路
3. **分布式系统常见挑战**——幂等性、消息可靠性、服务发现、负载均衡
4. **异步架构设计**——Kafka 在生产者和消费者之间的解耦作用
5. **容器化部署**——Dockerfile 编写、多服务编排、资源限制

当然，作为一个个人学习项目，它仍然有一些不完善之处（如测试覆盖率不足、部分配置硬编码、缺少 CI/CD 流水线等），这些都成为了后续迭代中的改进方向。

---

*项目持续迭代中，欢迎交流与指正。*
