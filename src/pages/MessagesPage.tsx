import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { absoluteAvatar, api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Shell } from '../ui/Shell';
import { Avatar } from '../ui/Avatar';
import type { FriendshipRow, Message } from '../api/types';

// Messagerie 1:1 entre amis. Volet gauche = liste des amis (dernier message +
// pastille non-lus), volet droit = fil de discussion + composer.
// Temps réel : invalidation via SSE (events "message.*", cf. useEvents) +
// polling 4s du fil ouvert en filet de sécurité.
export function MessagesPage() {
    const { user } = useAuth();
    const qc = useQueryClient();
    const [params, setParams] = useSearchParams();

    const { data: friendsData } = useQuery({
        queryKey: ['friends'],
        queryFn: () => api.listFriends(),
        staleTime: 30_000,
    });
    const friends = friendsData?.friends ?? [];

    const { data: conversations = [] } = useQuery({
        queryKey: ['conversations'],
        queryFn: () => api.listConversations(),
        refetchInterval: 12_000,
    });
    const unreadByUser = useMemo(() => {
        const m = new Map<string, { unread: number; last: Message | null }>();
        for (const c of conversations) m.set(c.user.id, { unread: c.unread, last: c.lastMessage });
        return m;
    }, [conversations]);

    // Ami sélectionné : par ?to=<pseudo> sinon le premier de la liste.
    const toPseudo = params.get('to');
    const [selectedId, setSelectedId] = useState<string | null>(null);
    useEffect(() => {
        if (toPseudo) {
            const match = friends.find((f) => f.user.pseudo.toLowerCase() === toPseudo.toLowerCase());
            if (match) setSelectedId(match.user.id);
        }
    }, [toPseudo, friends]);

    const selected = friends.find((f) => f.user.id === selectedId) ?? null;

    function selectFriend(f: FriendshipRow) {
        setSelectedId(f.user.id);
        // Nettoie ?to= pour éviter de re-forcer la sélection au refetch
        if (params.get('to')) { params.delete('to'); setParams(params, { replace: true }); }
    }

    return (
        <Shell title="Messages" subtitle="Discute avec tes amis">
            {friends.length === 0 ? (
                <div className="panel" style={{ color: 'var(--muted)', textAlign: 'center' }}>
                    Ajoute des amis pour leur écrire.
                </div>
            ) : (
                <div className="msg-layout">
                    {/* Volet liste — masqué sur mobile quand un fil est ouvert */}
                    <div className={`msg-list panel${selected ? ' has-selection' : ''}`} style={{ padding: 6 }}>
                        {friends.map((f) => {
                            const info = unreadByUser.get(f.user.id);
                            const active = f.user.id === selectedId;
                            return (
                                <button
                                    key={f.id}
                                    onClick={() => selectFriend(f)}
                                    className="msg-list-item"
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 12, width: '100%',
                                        padding: '10px 12px', borderRadius: 12, border: 'none', textAlign: 'left',
                                        background: active ? 'var(--surface-2)' : 'transparent', color: 'var(--text)',
                                    }}
                                >
                                    <Avatar seed={f.user.pseudo} size={40} imageUrl={absoluteAvatar(f.user.avatarUrl)} />
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.user.pseudo}</div>
                                        <div style={{ fontSize: 12.5, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {info?.last ? preview(info.last, user?.id) : 'Démarre la discussion'}
                                        </div>
                                    </div>
                                    {info && info.unread > 0 && (
                                        <span style={{
                                            minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9,
                                            background: 'var(--accent)', color: 'var(--accent-ink)',
                                            fontSize: 11, fontWeight: 800,
                                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                        }}>{info.unread}</span>
                                    )}
                                </button>
                            );
                        })}
                    </div>

                    {/* Volet conversation */}
                    <div className={`msg-thread panel${selected ? ' has-selection' : ''}`} style={{ padding: 0, display: 'flex', flexDirection: 'column', minHeight: 480 }}>
                        {selected ? (
                            <Thread friend={selected} meId={user?.id} onBack={() => setSelectedId(null)} />
                        ) : (
                            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', padding: 24 }}>
                                Choisis un ami pour discuter.
                            </div>
                        )}
                    </div>
                </div>
            )}

            <style>{`
        .msg-layout { display: grid; grid-template-columns: 300px 1fr; gap: 16px; }
        .msg-thread .msg-back { display: none; }
        @media (max-width: 768px) {
          .msg-layout { grid-template-columns: 1fr; }
          .msg-list.has-selection { display: none; }
          .msg-thread:not(.has-selection) { display: none; }
          .msg-thread .msg-back { display: inline-flex; }
        }
      `}</style>
        </Shell>
    );
}

function Thread({ friend, meId, onBack }: { friend: FriendshipRow; meId?: string; onBack: () => void }) {
    const qc = useQueryClient();
    const friendId = friend.user.id;
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const [draft, setDraft] = useState('');

    const { data: messages = [] } = useQuery({
        queryKey: ['messages', friendId],
        queryFn: () => api.getMessages(friendId),
        refetchInterval: 4_000,
    });

    // Marque comme lu à l'ouverture + quand de nouveaux messages arrivent.
    const readMut = useMutation({
        mutationFn: () => api.markMessagesRead(friendId),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['conversations'] }),
    });
    useEffect(() => {
        readMut.mutate();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [friendId, messages.length]);

    // Auto-scroll en bas à chaque nouveau message.
    useEffect(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [messages.length]);

    const sendMut = useMutation({
        mutationFn: (body: string) => api.sendMessage(friendId, body),
        onSuccess: () => {
            setDraft('');
            qc.invalidateQueries({ queryKey: ['messages', friendId] });
            qc.invalidateQueries({ queryKey: ['conversations'] });
        },
    });

    function send() {
        const body = draft.trim();
        if (!body || sendMut.isPending) return;
        sendMut.mutate(body.slice(0, 2000));
    }

    return (
        <>
            {/* En-tête du fil */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
                borderBottom: '1px solid var(--line)',
            }}>
                <button className="btn btn-line btn-sm msg-back" onClick={onBack} style={{ padding: '6px 10px' }}>←</button>
                <Avatar seed={friend.user.pseudo} size={36} imageUrl={absoluteAvatar(friend.user.avatarUrl)} />
                <div style={{ fontWeight: 700 }}>{friend.user.pseudo}</div>
            </div>

            {/* Fil */}
            <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {messages.length === 0 ? (
                    <div style={{ margin: 'auto', color: 'var(--muted)', fontSize: 14 }}>
                        Aucun message. Écris le premier !
                    </div>
                ) : (
                    messages.map((m) => <Bubble key={m.id} message={m} mine={m.senderId === meId} />)
                )}
            </div>

            {/* Composer */}
            <div style={{ display: 'flex', gap: 10, padding: 12, borderTop: '1px solid var(--line)' }}>
                <div className="field" style={{ flex: 1 }}>
                    <input
                        value={draft}
                        placeholder={`Écris à ${friend.user.pseudo}…`}
                        maxLength={2000}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                    />
                </div>
                <button className="btn btn-accent" onClick={send} disabled={!draft.trim() || sendMut.isPending}>
                    {sendMut.isPending ? '…' : 'Envoyer'}
                </button>
            </div>
        </>
    );
}

function Bubble({ message, mine }: { message: Message; mine: boolean }) {
    return (
        <div style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
            <div style={{
                maxWidth: '74%', padding: '9px 13px', borderRadius: 16,
                background: mine ? 'var(--accent)' : 'var(--surface-2)',
                color: mine ? 'var(--accent-ink)' : 'var(--text)',
                borderBottomRightRadius: mine ? 4 : 16,
                borderBottomLeftRadius: mine ? 16 : 4,
                fontSize: 14.5, lineHeight: 1.4, wordBreak: 'break-word', whiteSpace: 'pre-wrap',
            }}>
                {message.body}
                <span style={{
                    display: 'block', marginTop: 3, fontSize: 10.5,
                    color: mine ? 'color-mix(in srgb, var(--accent-ink) 60%, transparent)' : 'var(--muted)',
                    textAlign: 'right',
                }}>{formatTime(message.createdAt)}</span>
            </div>
        </div>
    );
}

function preview(m: Message, meId?: string): string {
    const prefix = m.senderId === meId ? 'Toi : ' : '';
    return prefix + m.body;
}

function formatTime(iso: string): string {
    const d = new Date(iso);
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    return sameDay
        ? d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
        : d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) + ' ' +
        d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}