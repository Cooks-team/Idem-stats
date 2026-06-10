import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { absoluteAvatar, api } from '../api/client';
import { Avatar } from './Avatar';

// Champ pseudo avec suggestions. Source 100% client : on agrège les joueurs
// classés (leaderboard) + les amis, on dédoublonne, et on filtre par sous-chaîne.
// Aucun endpoint backend supplémentaire nécessaire.
//
// Limite connue : un compte qui n'a jamais joué n'apparaît pas dans le
// leaderboard et ne sera donc pas suggéré tant qu'il n'est pas dans tes amis.
// (Si tu veux suggérer absolument tout le monde, ajoute un endpoint
// /users/search côté API et remplace la source ci-dessous.)

interface Suggestion {
    pseudo: string;
    avatarUrl: string | null;
    isFriend: boolean;
}

export function PseudoAutocomplete({
    value,
    onChange,
    label = 'Pseudo',
    placeholder = 'pseudo',
    exclude = [],
    autoFocus = false,
    onEnter,
}: {
    value: string;
    onChange: (v: string) => void;
    label?: string;
    placeholder?: string;
    exclude?: string[];          // pseudos à ne jamais suggérer (ex : le tien)
    autoFocus?: boolean;
    onEnter?: () => void;        // appelé sur Entrée quand aucune suggestion n'est surlignée
}) {
    const rootRef = useRef<HTMLDivElement | null>(null);
    const [open, setOpen] = useState(false);
    const [highlight, setHighlight] = useState(-1);

    const { data: entries = [] } = useQuery({
        queryKey: ['leaderboard', 'all'],
        queryFn: () => api.leaderboard(),
        staleTime: 60_000,
    });
    const { data: friendsData } = useQuery({
        queryKey: ['friends'],
        queryFn: () => api.listFriends(),
        staleTime: 30_000,
    });

    // Source dédoublonnée : amis d'abord (marqués), puis le reste du classement.
    const pool = useMemo<Suggestion[]>(() => {
        const map = new Map<string, Suggestion>();
        for (const f of friendsData?.friends ?? []) {
            map.set(f.user.pseudo.toLowerCase(), {
                pseudo: f.user.pseudo,
                avatarUrl: f.user.avatarUrl ?? null,
                isFriend: true,
            });
        }
        for (const e of entries) {
            const key = e.user.pseudo.toLowerCase();
            if (!map.has(key)) {
                map.set(key, { pseudo: e.user.pseudo, avatarUrl: e.user.avatarUrl ?? null, isFriend: false });
            }
        }
        const excludeSet = new Set(exclude.map((p) => p.toLowerCase()));
        return [...map.values()].filter((s) => !excludeSet.has(s.pseudo.toLowerCase()));
    }, [entries, friendsData, exclude]);

    const q = value.trim().toLowerCase();
    const matches = useMemo<Suggestion[]>(() => {
        if (q.length === 0) return [];
        return pool
            .filter((s) => s.pseudo.toLowerCase().includes(q) && s.pseudo.toLowerCase() !== q)
            // pseudos qui commencent par la saisie d'abord, amis prioritaires
            .sort((a, b) => {
                const aStarts = a.pseudo.toLowerCase().startsWith(q) ? 0 : 1;
                const bStarts = b.pseudo.toLowerCase().startsWith(q) ? 0 : 1;
                if (aStarts !== bStarts) return aStarts - bStarts;
                if (a.isFriend !== b.isFriend) return a.isFriend ? -1 : 1;
                return a.pseudo.localeCompare(b.pseudo);
            })
            .slice(0, 6);
    }, [pool, q]);

    // Fermer au clic extérieur
    useEffect(() => {
        if (!open) return;
        const onDoc = (e: MouseEvent) => {
            if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', onDoc);
        return () => document.removeEventListener('mousedown', onDoc);
    }, [open]);

    function pick(s: Suggestion) {
        onChange(s.pseudo);
        setOpen(false);
        setHighlight(-1);
    }

    function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
        if (open && matches.length > 0) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => (h + 1) % matches.length); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => (h - 1 + matches.length) % matches.length); return; }
            if (e.key === 'Escape') { setOpen(false); setHighlight(-1); return; }
            if (e.key === 'Enter' && highlight >= 0) { e.preventDefault(); pick(matches[highlight]); return; }
        }
        if (e.key === 'Enter') onEnter?.();
    }

    const showList = open && matches.length > 0;

    return (
        <div ref={rootRef} style={{ position: 'relative' }}>
            <div className="field">
                <div className="field-label">{label}</div>
                <input
                    autoFocus={autoFocus}
                    value={value}
                    placeholder={placeholder}
                    autoComplete="off"
                    onChange={(e) => { onChange(e.target.value); setOpen(true); setHighlight(-1); }}
                    onFocus={() => setOpen(true)}
                    onKeyDown={onKeyDown}
                />
            </div>

            {showList && (
                <div
                    role="listbox"
                    style={{
                        position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 60,
                        background: 'var(--surface)', border: '1px solid var(--line)',
                        borderRadius: 14, boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
                        padding: 6, maxHeight: 280, overflowY: 'auto',
                    }}
                >
                    {matches.map((s, i) => (
                        <button
                            key={s.pseudo}
                            type="button"
                            role="option"
                            aria-selected={i === highlight}
                            onMouseDown={(e) => { e.preventDefault(); pick(s); }}
                            onMouseEnter={() => setHighlight(i)}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                                padding: '8px 10px', borderRadius: 10, border: 'none', textAlign: 'left',
                                background: i === highlight ? 'var(--surface-2)' : 'transparent',
                                color: 'var(--text)',
                            }}
                        >
                            <Avatar seed={s.pseudo} size={30} imageUrl={absoluteAvatar(s.avatarUrl)} />
                            <span style={{ flex: 1, minWidth: 0, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {s.pseudo}
                            </span>
                            {s.isFriend && <span className="tag tag-accent">AMI</span>}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}