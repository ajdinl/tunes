// Loaded with `node --import` before server.ts in tests: the server sees the fake internet.
import { installFakeNet } from './fake-net.js';

installFakeNet();
