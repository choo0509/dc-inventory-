// Replace your existing /api/racks route and inferEquipmentType() with this.
// Changes: (1) "Empty slot" rows create a spare rack but are not drawn as devices,
// (2) a U range like "36-37" in the inventory's U# field becomes a 2U device,
// (3) each device gets a `kind` (firewall / router / switch ...) for 3D colours,
// (4) the label is the model name, not the Item #.
// Also delete the old `openEditModal` deep-link snippet: index.html now handles #item=<id> itself.

app.get('/api/racks', requireAuth, async (req, res) => {
  const { location, row } = req.query;
  if (!location || !row) return res.status(400).json({ error: 'location and row required' });
  try {
    const items = await db.all(
      'SELECT id, location, "row", rack, u, model, serial, item, status, purpose, assetTag FROM items WHERE location=? AND "row"=? ORDER BY rack, CAST(u AS INTEGER) DESC',
      [location, row]
    );
    const racks = {};
    items.forEach(item => {
      const rackNum = item.rack || '0';
      const rackId = 'R' + rackNum;
      if (!racks[rackId]) racks[rackId] = { id: rackId, location: item.location, row: item.row, rack: rackNum, status: 'Spare', equipment: [] };
      if (item.model === 'Empty slot') return;
      racks[rackId].status = 'Active';
      const m = String(item.u || '').match(/^(\d+)\s*[-–]\s*(\d+)$/);
      const a = m ? +m[1] : parseInt(item.u) || 1, b = m ? +m[2] : a;
      const info = inferEquipmentType(item);
      racks[rackId].equipment.push({
        id: item.id,
        label: item.model || item.item || item.serial || 'Unknown',
        type: info.type, kind: info.kind,
        uPosition: Math.min(a, b), uSize: Math.abs(b - a) + 1,
        serial: item.serial, status: item.status, purpose: item.purpose, assetTag: item.assetTag
      });
    });
    res.json(Object.values(racks));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function inferEquipmentType(item) {
  const t = ((item.model || '') + ' ' + (item.item || '') + ' ' + (item.purpose || '')).toLowerCase();
  if (t.includes('firewall')) return { type: 'network', kind: 'firewall' };
  if (t.includes('router')) return { type: 'network', kind: 'router' };
  if (t.includes('switch') || t.includes('kemp') || t.includes('load balancer')) return { type: 'network', kind: 'switch' };
  if (t.includes('storage') || t.includes('stor')) return { type: 'storage', kind: 'storage' };
  if (t.includes('pdu')) return { type: 'pdu', kind: 'pdu' };
  return { type: 'server', kind: 'server' };
}
