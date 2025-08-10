import { useEffect, useMemo, useRef, useState } from 'react';
import { getSocket } from './lib/socket';
import { useAuthStore } from './store/auth';
import Peer from 'simple-peer';

function Login() {
  const [phone, setPhone] = useState('');
  const [displayName, setDisplayName] = useState('');
  const setUser = useAuthStore((s) => s.setUser);

  function onLogin() {
    const socket = getSocket();
    socket.emit('auth:login', { phone, displayName });
    socket.once('auth:ok', (data: any) => setUser(data.user));
  }

  return (
    <div style={{ display: 'grid', gap: 8, maxWidth: 360 }}>
      <input placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
      <input placeholder="Name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      <button onClick={onLogin}>Login</button>
    </div>
  );
}

function Chat() {
  const user = useAuthStore((s) => s.user)!;
  const socket = useMemo(() => getSocket(), []);
  const [convId, setConvId] = useState<string>('');
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<any[]>([]);

  useEffect(() => {
    const h = (m: any) => setMessages((prev) => [...prev, m]);
    socket.on('message:new', h);
    return () => {
      socket.off('message:new', h);
    };
  }, [socket]);

  function createConversation() {
    const phone = prompt('Friend phone?');
    if (!phone) return;
    socket.emit('conversation:create', { participantPhones: [phone] });
    socket.once('conversation:new', (c: any) => setConvId(c.id));
  }

  function sendMessage() {
    if (!convId) return;
    socket.emit('message:send', { conversationId: convId, content: message });
    setMessage('');
  }

  // WebRTC
  const peerRef = useRef<Peer.Instance | null>(null);
  const myVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const onOffer = async ({ callId, sdp }: any) => {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      const peer = new Peer({ initiator: false, trickle: true, stream });
      peer.on('signal', (data) => socket.emit('call:answer', { callId, sdp: data }));
      peer.on('stream', (remote) => {
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remote as any;
      });
      peer.signal(sdp);
      peerRef.current = peer;
      if (myVideoRef.current) myVideoRef.current.srcObject = stream as any;
    };
    const onAnswer = ({ sdp }: any) => {
      peerRef.current?.signal(sdp);
    };
    const onCandidate = ({ candidate }: any) => {
      peerRef.current?.signal(candidate);
    };
    socket.on('call:offer', onOffer);
    socket.on('call:answer', onAnswer);
    socket.on('call:candidate', onCandidate);
    return () => {
      socket.off('call:offer', onOffer);
      socket.off('call:answer', onAnswer);
      socket.off('call:candidate', onCandidate);
    };
  }, [socket]);

  async function startCall() {
    if (!convId) return;
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    const peer = new Peer({ initiator: true, trickle: true, stream });
    peer.on('signal', (data) => socket.emit('call:offer', { conversationId: convId, sdp: data }));
    peer.on('stream', (remote) => {
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remote as any;
    });
    peerRef.current = peer;
    if (myVideoRef.current) myVideoRef.current.srcObject = stream as any;
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div>Logged in as {user.displayName} ({user.phone})</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={createConversation}>New Chat</button>
        <input placeholder="Conversation ID" value={convId} onChange={(e) => setConvId(e.target.value)} />
        <button onClick={startCall}>Start Call</button>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input placeholder="Type a message" value={message} onChange={(e) => setMessage(e.target.value)} />
        <button onClick={sendMessage}>Send</button>
      </div>
      <div>
        {messages.map((m) => (
          <div key={m.id}>{m.content ?? m.type}</div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 12 }}>
        <video ref={myVideoRef} autoPlay muted playsInline width={240} height={180} />
        <video ref={remoteVideoRef} autoPlay playsInline width={240} height={180} />
      </div>
    </div>
  );
}

export default function App() {
  const user = useAuthStore((s) => s.user);
  return (
    <div style={{ padding: 16 }}>
      <h2>UMeet</h2>
      {user ? <Chat /> : <Login />}
    </div>
  );
}
