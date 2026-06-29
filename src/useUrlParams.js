import { useState, useEffect } from "react";

export function useUrlParams() {
    const [params, setParams] = useState(() => new URLSearchParams(window.location.search));

    useEffect(() => {
        const handler = () => setParams(new URLSearchParams(window.location.search));
        window.addEventListener("popstate", handler);
        return () => window.removeEventListener("popstate", handler);
    }, []);

    const updateParams = (newObj, replace = false) => {
        const p = new URLSearchParams(window.location.search);
        for (const k in newObj) {
            if (newObj[k] === null || newObj[k] === undefined) {
                p.delete(k);
            } else {
                p.set(k, newObj[k]);
            }
        }
        const qs = p.toString() ? "?" + p.toString() : "";
        const newUrl = window.location.pathname + qs;
        if (replace) window.history.replaceState(null, "", newUrl);
        else window.history.pushState(null, "", newUrl);
        setParams(new URLSearchParams(qs));
        window.dispatchEvent(new Event("popstate"));
    };

    return [params, updateParams];
}