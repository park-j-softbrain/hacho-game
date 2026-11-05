import { renderSVG } from "uqr";
import { storage, useGame } from "../net";
import { Center } from "../ui";
import { ADMIN_KEY } from "./Admin";

// Printable cards, one per table. Each QR opens that table's page with its token.
export function QrSheetPage() {
  const key = storage.get(ADMIN_KEY);
  if (!key) {
    return (
      <Center>
        <p>
          先に <a href="/admin">管理画面</a> でログインしてください
        </p>
      </Center>
    );
  }
  return <Sheet k={key} />;
}

function Sheet({ k }: { k: string }) {
  const { view, fatal } = useGame(`role=admin&k=${encodeURIComponent(k)}`);
  if (fatal) return <Center>{fatal}</Center>;
  if (!view?.admin) return <Center>接続中…</Center>;
  const { tableCount, tokens } = view.admin;
  const local = ["localhost", "127.0.0.1"].includes(location.hostname);

  return (
    <div class="qr-page">
      <div class="no-print qr-intro">
        <h1>テーブル用QRコード（{tableCount}枚）</h1>
        <p>各テーブルに1枚ずつ置いてください。QRコードはテーブル番号ごとに固定で、リセットしても変わりません。</p>
        {local && (
          <p class="banner-error">
            このページは localhost で開いているため、スマホからは読み取れません。公開後のURL（または同じWi-FiのPCのIPアドレス）で開き直して印刷してください。
          </p>
        )}
        <button class="primary" onClick={() => print()}>
          印刷する
        </button>
      </div>
      <div class="qr-cards">
        {Array.from({ length: tableCount }, (_, i) => i + 1).map((n) => {
          const url = `${location.origin}/t/${n}/${tokens[n]}`;
          return (
            <div class="qr-card">
              <div class="qr-title">{view.title}</div>
              <div class="qr-no">テーブル {n}</div>
              <div class="qr-code" dangerouslySetInnerHTML={{ __html: renderSVG(url, { border: 1 }) }} />
              <div class="qr-hint">スマホのカメラで読み取って参加してください</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
