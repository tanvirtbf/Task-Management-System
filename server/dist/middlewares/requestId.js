"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestIdMiddleware = void 0;
const crypto_1 = require("crypto");
const REQUEST_ID_HEADER = "x-request-id";
const MAX_INCOMING_ID_LENGTH = 200;
const requestIdMiddleware = (req, res, next) => {
    const incoming = req.header(REQUEST_ID_HEADER);
    const id = incoming && incoming.length > 0 && incoming.length <= MAX_INCOMING_ID_LENGTH
        ? incoming
        : `req_${(0, crypto_1.randomUUID)()}`;
    req.requestId = id;
    res.setHeader("X-Request-Id", id);
    next();
};
exports.requestIdMiddleware = requestIdMiddleware;
