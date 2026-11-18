# Windows 签名与 GitHub 发布

Windows 的 Authenticode 签名验证发布者身份和文件完整性。GitHub 下载还会经过 SmartScreen 声誉检查。新签名的安装包在建立声誉期间仍可能提示“无法识别的应用”。正式发布使用同一受验证的发布者身份，对签名后的最终附件生成 SHA-256，并从项目 Release 提供下载。[微软 SmartScreen 说明](https://learn.microsoft.com/windows/apps/package-and-deploy/smartscreen-reputation)

## 签名凭据

- **公共信任 CA 签发的代码签名证书**。在签名机接入 CA 提供的硬件令牌或密钥服务，使证书和密钥提供程序出现在 `Cert:\CurrentUser\My` 或 `Cert:\LocalMachine\My`。将证书指纹设为 `MINERADIO_SIGN_CERT_THUMBPRINT`。脚本通过证书库调用密钥提供程序。
- **Microsoft Artifact Signing**。在支持的地区完成身份验证，使用 `Public Trust` 证书配置文件。将 x64 签名客户端 DLL 路径设为 `MINERADIO_SIGN_DLIB`，账户元数据 JSON 路径设为 `MINERADIO_SIGN_METADATA`，在本机或 CI 通过 Azure 凭据对服务进行认证。[微软签名接入文档](https://learn.microsoft.com/azure/trusted-signing/how-to-signing-integrations)

Windows SDK 的 x64 `signtool.exe` 会从 PATH 或已登记的 SDK 中查找。云签名客户端需要特定 SDK 版本时，用 `MINERADIO_SIGNTOOL` 指定其完整路径。构建使用 SHA-256 和 RFC 3161 时间戳。CA 如指定了时间戳服务，可通过 `MINERADIO_SIGN_TIMESTAMP_URL` 设置。[Authenticode 时间戳说明](https://learn.microsoft.com/windows/win32/seccrypto/time-stamping-authenticode-signatures)

## 生成发布附件

配置上述任一签名凭据后，从仓库根目录运行以下命令。示例使用 1.1.0-rc.2。

```powershell
python tools/build-desktop.py --output .runtime/signing-1.1.0-rc.2
npm run build:setup:signed -- --prepackaged .runtime/signing-1.1.0-rc.2 --output artifacts/1.1.0-rc.2-signed
python tools/package-candidate.py --directory artifacts/1.1.0-rc.2-signed/.build/payload --release artifacts/1.1.0-rc.2-signed
```

流程会先签名主程序，再签名 NSIS 卸载器和安装器。Windows 验签通过后，正式附件才会出现在输出目录顶层。Node.js 使用上游已签名的固定二进制。便携 ZIP 使用与安装器相同的签名文件。

发布前核对 `build-receipt.json` 中的 `signing.status` 为 `verified`，并核对 `signing.publisher`。在 GitHub Release 上传生成的安装包、便携包、对应源码与校验文件。安全软件给出具体威胁名称时，使用微软的软件开发者误报提交入口提供相同的最终文件。[微软文件误报提交](https://www.microsoft.com/wdsi/filesubmission)
