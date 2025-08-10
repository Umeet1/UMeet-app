import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

const prisma = new PrismaClient();

const app = express();
app.use(cors());
app.use(express.json());

const server = createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: '*' },
});

// In-memory maps for demo
const userIdToSocketId = new Map<string, string>();
const socketIdToUserId = new Map<string, string>();

io.on('connection', (socket: Socket) => {
  // Join rooms by conversation after auth
  socket.on('auth:login', async (payload: { phone: string; displayName?: string }) => {
    const schema = z.object({ phone: z.string().min(6), displayName: z.string().optional() });
    const { phone, displayName } = schema.parse(payload);

    let user = await prisma.user.findUnique({ where: { phone } });
    if (!user) {
      user = await prisma.user.create({ data: { phone, displayName: displayName ?? phone } });
    }

    userIdToSocketId.set(user.id, socket.id);
    socketIdToUserId.set(socket.id, user.id);
    socket.emit('auth:ok', { user });
  });

  socket.on('conversation:create', async (payload: { participantPhones: string[]; title?: string }) => {
    const schema = z.object({ participantPhones: z.array(z.string()).min(1), title: z.string().optional() });
    const { participantPhones, title } = schema.parse(payload);
    const me = socketIdToUserId.get(socket.id);
    if (!me) return;

    const participants = await prisma.user.findMany({ where: { phone: { in: participantPhones } } });
    const conversation = await prisma.conversation.create({
      data: {
        isGroup: participants.length > 1,
        title: title ?? null,
        participants: {
          create: [
            { userId: me },
            ...participants.map((p) => ({ userId: p.id })),
          ],
        },
      },
      include: { participants: { include: { user: true } } },
    });

    const targetSocketIds = [
      ...new Set(
        conversation.participants
          .map((p) => userIdToSocketId.get(p.userId))
          .filter((x): x is string => Boolean(x))
      ),
    ];
    targetSocketIds.forEach((sid) => io.to(sid).emit('conversation:new', conversation));

    // join all participants to the conversation room if connected
    const room = `conv:${conversation.id}`;
    io.sockets.sockets.get(socket.id)?.join(room);
    conversation.participants.forEach((p) => {
      const sid = userIdToSocketId.get(p.userId);
      if (sid) io.sockets.sockets.get(sid)?.join(room);
    });
  });

  socket.on('message:send', async (payload: { conversationId: string; content?: string; type?: 'TEXT'|'IMAGE'|'AUDIO'|'VIDEO'|'FILE'; mediaUrl?: string }) => {
    const schema = z.object({
      conversationId: z.string().cuid(),
      content: z.string().optional(),
      type: z.enum(['TEXT', 'IMAGE', 'AUDIO', 'VIDEO', 'FILE']).optional(),
      mediaUrl: z.string().url().optional(),
    });
    const { conversationId, content, type, mediaUrl } = schema.parse(payload);
    const me = socketIdToUserId.get(socket.id);
    if (!me) return;

    const message = await prisma.message.create({
      data: {
        conversationId,
        senderId: me,
        content: content ?? null,
        type: (type ?? 'TEXT') as any,
        mediaUrl: mediaUrl ?? null,
      },
    });

    const participants = await prisma.conversationParticipant.findMany({ where: { conversationId } });
    const targetSocketIds = participants
      .map((p) => userIdToSocketId.get(p.userId))
      .filter((x): x is string => Boolean(x));

    targetSocketIds.forEach((sid) => io.to(sid).emit('message:new', message));
    io.to(`conv:${conversationId}`).emit('message:new', message);
  });

  // WebRTC signaling
  socket.on('call:offer', async (payload: { conversationId: string; sdp: any }) => {
    const me = socketIdToUserId.get(socket.id);
    if (!me) return;
    const call = await prisma.call.create({ data: { conversationId: payload.conversationId, initiatorId: me } });
    socket.to(`conv:${payload.conversationId}`).emit('call:offer', { callId: call.id, sdp: payload.sdp });
  });

  socket.on('call:answer', (payload: { callId: string; sdp: any }) => {
    socket.broadcast.emit('call:answer', payload);
  });

  socket.on('call:candidate', (payload: { callId: string; candidate: any }) => {
    socket.broadcast.emit('call:candidate', payload);
  });

  socket.on('disconnect', () => {
    const me = socketIdToUserId.get(socket.id);
    if (me) {
      userIdToSocketId.delete(me);
      socketIdToUserId.delete(socket.id);
    }
  });
});

app.get('/', (_req, res) => {
  res.json({ ok: true });
});

const PORT = Number(process.env.PORT || 4000);
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});