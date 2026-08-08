-- PR-A gazetteer schema and audited seed data (20 locations / 30 aliases).
CREATE TABLE locations (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('station', 'city', 'ward', 'landmark', 'prefecture')),
    latitude    DOUBLE PRECISION NOT NULL,
    longitude   DOUBLE PRECISION NOT NULL,
    location    GEOGRAPHY(POINT, 4326),
    source      TEXT NOT NULL CHECK (source IN ('seed', 'mlit', 'geonames', 'manual')),
    pref        TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER trg_locations_sync_coordinates
    BEFORE INSERT OR UPDATE ON locations
    FOR EACH ROW EXECUTE FUNCTION sync_points_coordinates();

CREATE TABLE location_aliases (
    alias             TEXT NOT NULL,
    alias_normalized  TEXT NOT NULL,
    location_id       TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    lang              TEXT CHECK (lang IN ('ja', 'zh', 'en') OR lang IS NULL),
    priority          INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (alias_normalized, location_id)
);

CREATE INDEX idx_location_aliases_norm ON location_aliases (alias_normalized);
GRANT SELECT ON locations, location_aliases TO catalog_svc;

INSERT INTO locations (id, name, kind, latitude, longitude, source, pref) VALUES
    ('seed:uji', '宇治', 'city', 34.8843, 135.7997, 'seed', '京都府'),
    ('seed:kyoto', '京都', 'city', 35.0116, 135.7681, 'seed', '京都府'),
    ('seed:kyoto-station', '京都駅', 'station', 34.9858, 135.7588, 'seed', '京都府'),
    ('seed:tokyo-station', '東京駅', 'station', 35.6812, 139.7671, 'seed', '東京都'),
    ('seed:tokyo', '東京', 'city', 35.6762, 139.6503, 'seed', '東京都'),
    ('seed:shinjuku', '新宿', 'ward', 35.6896, 139.7006, 'seed', '東京都'),
    ('seed:akihabara', '秋葉原', 'landmark', 35.7023, 139.7745, 'seed', '東京都'),
    ('seed:takayama', '飛騨高山', 'city', 36.1461, 137.2522, 'seed', '岐阜県'),
    ('seed:kamakura', '鎌倉', 'city', 35.3192, 139.5467, 'seed', '神奈川県'),
    ('seed:osaka', '大阪', 'city', 34.6937, 135.5023, 'seed', '大阪府'),
    ('seed:shibuya', '渋谷', 'ward', 35.6580, 139.7016, 'seed', '東京都'),
    ('seed:ikebukuro', '池袋', 'landmark', 35.7295, 139.7109, 'seed', '東京都'),
    ('seed:yokohama', '横浜', 'city', 35.4437, 139.6380, 'seed', '神奈川県'),
    ('seed:nara', '奈良', 'city', 34.6851, 135.8048, 'seed', '奈良県'),
    ('seed:hiroshima', '広島', 'city', 34.3853, 132.4553, 'seed', '広島県'),
    ('seed:hiroshima-station', '広島駅', 'station', 34.3976, 132.4753, 'seed', '広島県'),
    ('seed:nagoya', '名古屋', 'city', 35.1815, 136.9066, 'seed', '愛知県'),
    ('seed:uji-station', '宇治駅', 'station', 34.8891, 135.8008, 'seed', '京都府'),
    ('seed:rokujizo', '六地蔵', 'station', 34.9340, 135.7930, 'seed', '京都府'),
    ('seed:nishinomiya-station', '西宮駅', 'station', 34.7386, 135.3485, 'manual', '兵庫県');

INSERT INTO location_aliases (alias, alias_normalized, location_id, lang, priority) VALUES
    ('宇治', '宇治', 'seed:uji', 'ja', 100),
    ('京都', '京都', 'seed:kyoto', 'ja', 100),
    ('京都站', '京都站', 'seed:kyoto-station', 'zh', 90),
    ('京都駅', '京都駅', 'seed:kyoto-station', 'ja', 100),
    ('東京駅', '東京駅', 'seed:tokyo-station', 'ja', 100),
    ('东京站', '东京站', 'seed:tokyo-station', 'zh', 90),
    ('東京', '東京', 'seed:tokyo', 'ja', 100),
    ('东京', '东京', 'seed:tokyo', 'zh', 90),
    ('新宿', '新宿', 'seed:shinjuku', 'ja', 100),
    ('秋叶原', '秋叶原', 'seed:akihabara', 'zh', 90),
    ('秋葉原', '秋葉原', 'seed:akihabara', 'ja', 100),
    ('飛騨高山', '飛騨高山', 'seed:takayama', 'ja', 100),
    ('高山', '高山', 'seed:takayama', 'ja', 90),
    ('鎌倉', '鎌倉', 'seed:kamakura', 'ja', 100),
    ('镰仓', '镰仓', 'seed:kamakura', 'zh', 90),
    ('大阪', '大阪', 'seed:osaka', 'ja', 100),
    ('渋谷', '渋谷', 'seed:shibuya', 'ja', 100),
    ('涩谷', '涩谷', 'seed:shibuya', 'zh', 90),
    ('池袋', '池袋', 'seed:ikebukuro', 'ja', 100),
    ('横浜', '横浜', 'seed:yokohama', 'ja', 100),
    ('横滨', '横滨', 'seed:yokohama', 'zh', 90),
    ('奈良', '奈良', 'seed:nara', 'ja', 100),
    ('広島', '広島', 'seed:hiroshima', 'ja', 100),
    ('広島駅', '広島駅', 'seed:hiroshima-station', 'ja', 100),
    ('名古屋', '名古屋', 'seed:nagoya', 'ja', 100),
    ('宇治駅', '宇治駅', 'seed:uji-station', 'ja', 100),
    ('六地蔵', '六地蔵', 'seed:rokujizo', 'ja', 100),
    ('西宮', '西宮', 'seed:nishinomiya-station', 'ja', 100),
    ('西宫', '西宫', 'seed:nishinomiya-station', 'zh', 90),
    ('nishinomiya', 'nishinomiya', 'seed:nishinomiya-station', 'en', 90);
