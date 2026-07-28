"use strict";
/**
 * §24 Search types.
 *
 * Search has no request body — only `?q=&types=&limit=` query params (parsed in
 * the controller). The one shape worth naming is the wire `Comment` returned in
 * results: §14 Comments is not built and has no serializer, so search emits its
 * own snake_case projection that mirrors the actual `comments` table (NOT the
 * frontend `Comment` type, which carries reactions/resolve fields the DB lacks).
 */
Object.defineProperty(exports, "__esModule", { value: true });
