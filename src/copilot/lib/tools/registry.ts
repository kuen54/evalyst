// Thin re-export shim — canonical home is server-registry.ts. Existing
// consumers `import { TOOLS, toolByName, type AnyToolDescriptor } from
// "./tools/registry"` keep working unchanged.
//
// 历史路径保留是为了不在 #10 PR 内顺手大改 14 个 consumer call sites；
// 后续可独立 PR 收拢到 server-registry.ts。

export { TOOLS, toolByName, type AnyToolDescriptor } from "./server-registry"
