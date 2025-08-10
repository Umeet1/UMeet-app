import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server as SocketIOServer } from 'socket.io';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
const prisma = new PrismaClient();
const app = express();
app.use(cors());
app.use(express.json());
const server = http.createServer(app);
const io = new SocketIOServer(server, {
    cors: { origin: '*' },
});
// In-memory maps for demo
const userIdToSocketId = new Map();
const socketIdToUserId = new Map();
io.on('connection', (socket) => {
    socket.on('auth:login', async (payload) => {
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
    socket.on('conversation:create', async (payload) => {
        const schema = z.object({ participantPhones: z.array(z.string()).min(1), title: z.string().optional() });
        const { participantPhones, title } = schema.parse(payload);
        const me = socketIdToUserId.get(socket.id);
        if (!me)
            return;
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
            ...new Set(conversation.participants
                .map((p) => userIdToSocketId.get(p.userId))
                .filter((x) => Boolean(x))),
        ];
        targetSocketIds.forEach((sid) => io.to(sid).emit('conversation:new', conversation));
    });
    socket.on('message:send', async (payload) => {
        const schema = z.object({
            conversationId: z.string().cuid(),
            content: z.string().optional(),
            type: z.enum(['TEXT', 'IMAGE', 'AUDIO', 'VIDEO', 'FILE']).optional(),
            mediaUrl: z.string().url().optional(),
        });
        const { conversationId, content, type, mediaUrl } = schema.parse(payload);
        const me = socketIdToUserId.get(socket.id);
        if (!me)
            return;
        const message = await prisma.message.create({
            data: {
                conversationId,
                senderId: me,
                content: content ?? null,
                type: (type ?? 'TEXT'),
                mediaUrl: mediaUrl ?? null,
            },
        });
        const participants = await prisma.conversationParticipant.findMany({ where: { conversationId } });
        const targetSocketIds = participants
            .map((p) => userIdToSocketId.get(p.userId))
            .filter((x) => Boolean(x));
        targetSocketIds.forEach((sid) => io.to(sid).emit('message:new', message));
    });
    // WebRTC signaling
    socket.on('call:offer', async (payload) => {
        const me = socketIdToUserId.get(socket.id);
        if (!me)
            return;
        const call = await prisma.call.create({ data: { conversationId: payload.conversationId, initiatorId: me } });
        const participants = await prisma.conversationParticipant.findMany({ where: { conversationId: payload.conversationId } });
        participants
            .map((p) => userIdToSocketId.get(p.userId))
            .filter((sid) => Boolean(sid))
            .forEach((sid) => io.to(sid).emit('call:offer', { callId: call.id, sdp: payload.sdp }));
    });
    socket.on('call:answer', (payload) => {
        io.emit('call:answer', payload);
    });
    socket.on('call:candidate', (payload) => {
        io.emit('call:candidate', payload);
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
//# sourceMappingURL=index.js.map