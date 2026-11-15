import { useState, useEffect } from "react";
import { ref, onValue } from "firebase/database";
import { db } from "./firebase";

// GM（部屋の作成）権限は Firebase の admins/{uid} === true で管理する（コンソールから手動で付与）。
// ルール側も同じノードで部屋作成を強制するため、クライアントの判定は表示制御のためだけ。
// （以前はメールアドレスをコードとルールに直書きしていたが、配信 JS に個人情報が載るため廃止）
export function useIsAllowedGm(user) {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    if (!user?.uid) { setAllowed(false); return; }
    const unsub = onValue(ref(db, `admins/${user.uid}`),
      snap => setAllowed(snap.val() === true),
      () => setAllowed(false));
    return () => unsub();
  }, [user?.uid]);
  return allowed;
}
