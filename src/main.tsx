import { render } from "preact";
import "./style.css";
import { Center } from "./ui";

// Each page is its own chunk, so a phone downloads only the table page.
//   /t/<table>/<token>  phones (from the table's QR code)
//   /screen             projector
//   /admin, /admin/qr   staff
async function main() {
  const root = document.getElementById("app")!;
  const path = location.pathname.replace(/\/+$/, "");
  const table = path.match(/^\/t\/(\d+)\/([\w-]+)$/);

  if (table) {
    document.body.dataset.page = "table";
    const { TablePage } = await import("./pages/Table");
    render(<TablePage n={Number(table[1])} k={table[2]} />, root);
  } else if (path === "/screen") {
    document.body.dataset.page = "screen";
    const { ScreenPage } = await import("./pages/Screen");
    render(<ScreenPage />, root);
  } else if (path === "/admin") {
    document.body.dataset.page = "admin";
    const { AdminPage } = await import("./pages/Admin");
    render(<AdminPage />, root);
  } else if (path === "/admin/qr") {
    document.body.dataset.page = "qr";
    const { QrSheetPage } = await import("./pages/QrSheet");
    render(<QrSheetPage />, root);
  } else {
    render(
      <Center>
        <p class="big">テーブルに置いてあるQRコードを、スマホのカメラで読み取ってください</p>
      </Center>,
      root,
    );
  }
}

main();
