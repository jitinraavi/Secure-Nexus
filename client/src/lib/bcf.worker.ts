import { inflateBcfArchive } from "./bcfArchive";

const scope = self as unknown as { onmessage: ((event: MessageEvent<Uint8Array>) => void) | null; postMessage(message: unknown, transfer?: Transferable[]): void; };
scope.onmessage = ({ data }) => {
  void inflateBcfArchive(data).then(entries => {
    scope.postMessage({ ok: true, entries }, entries.map(entry => entry.bytes.buffer as ArrayBuffer));
  }).catch(error => {
    scope.postMessage({ ok: false, error: error instanceof Error ? error.message : "BCF import failed." });
  });
};
