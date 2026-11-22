// The proxies only reach the public internet (lib/netguard.ts).
import { describe, expect, it } from 'vitest';

import { assertPublicUrl, isPrivateIp } from '../../lib/netguard.ts';

describe('private addresses', () => {
  it('knows the home network, loopback, link-local and cloud metadata addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.100.1.1', '0.0.0.0', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:192.168.1.1', '[::1]']) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
    for (const ip of ['1.1.1.1', '8.8.8.8', '172.32.0.1', '100.128.0.1', '2606:4700::1111', '::ffff:8.8.8.8']) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });

  it('refuses such addresses, localhost and other protocols', async () => {
    for (const u of ['http://127.0.0.1:4545/api/export', 'http://localhost/', 'http://[::1]/', 'http://169.254.169.254/latest/meta-data', 'file:///etc/passwd', 'ftp://example.org/']) {
      await expect(assertPublicUrl(u), u).rejects.toThrow('Address not allowed');
    }
    await expect(assertPublicUrl('https://1.1.1.1/')).resolves.toBeInstanceOf(URL);
  });
});
