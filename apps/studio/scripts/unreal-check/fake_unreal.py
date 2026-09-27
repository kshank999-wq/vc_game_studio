"""Just enough of Unreal's Python API for build_level.py to run outside the
editor: actors, their properties, tags and attachments, kept in memory, so
the check can look at what the script placed. Nothing is rendered or saved."""
import math

_content = ""
_actors = []


class Paths:
    @staticmethod
    def project_content_dir():
        return _content


class Vector:
    def __init__(self, x=0.0, y=0.0, z=0.0):
        self.x, self.y, self.z = float(x), float(y), float(z)

    def __add__(self, o):
        return Vector(self.x + o.x, self.y + o.y, self.z + o.z)

    def __sub__(self, o):
        return Vector(self.x - o.x, self.y - o.y, self.z - o.z)

    def length(self):
        return math.sqrt(self.x ** 2 + self.y ** 2 + self.z ** 2)

    def __repr__(self):
        return "Vector(%g, %g, %g)" % (self.x, self.y, self.z)


class Rotator:
    def __init__(self, roll=0.0, pitch=0.0, yaw=0.0):
        self.roll, self.pitch, self.yaw = float(roll), float(pitch), float(yaw)


class LinearColor:
    def __init__(self, r, g, b, a):
        self.r, self.g, self.b, self.a = r, g, b, a


class AttachmentRule:
    KEEP_RELATIVE = 0
    KEEP_WORLD = 1


class _Component:
    def __init__(self):
        self.calls = {}

    def __getattr__(self, name):
        def record(*args):
            self.calls[name] = args
        return record


class Actor:
    def __init__(self, location, rotation):
        self._location = location
        self._rotation = rotation
        self._label = ""
        self._props = {}
        self._parent = None
        self.tags = []
        self.relative = {}
        self.static_mesh_component = _Component()
        self._props["box"] = _Component()
        self._props["light_component"] = _Component()
        self.destroyed = False

    def set_actor_label(self, label):
        self._label = label

    def get_actor_label(self):
        return self._label

    def get_editor_property(self, name):
        return self._props.get(name, "" if name not in ("exported", "exported_yaw", "exported_location") else (False if name == "exported" else (0.0 if name == "exported_yaw" else Vector())))

    def set_editor_property(self, name, value):
        self._props[name] = value

    def get_actor_location(self):
        return self._location

    def set_actor_location(self, location, sweep, teleport):
        self._location = location

    def get_actor_rotation(self):
        return self._rotation

    def set_actor_rotation(self, rotation, teleport):
        self._rotation = rotation

    def attach_to_actor(self, parent, socket, a, b, c, weld):
        self._parent = parent

    def get_attached_actors(self):
        return [x for x in _actors if x._parent is self and not x.destroyed]

    def actor_has_tag(self, tag):
        return tag in self.tags

    def destroy_actor(self):
        self.destroyed = True
        _actors.remove(self)

    def set_actor_relative_location(self, v, sweep, teleport):
        self.relative["location"] = v

    def set_actor_relative_rotation(self, r, sweep, teleport):
        self.relative["rotation"] = r

    def set_actor_relative_scale3d(self, s):
        self.relative["scale"] = s


class VcgsLevelItem(Actor):
    pass


class VcgsLevelDirector(Actor):
    pass


class StaticMeshActor(Actor):
    pass


class PointLight(Actor):
    pass


class SpotLight(Actor):
    pass


class PlayerStart(Actor):
    pass


class EditorLevelLibrary:
    @staticmethod
    def spawn_actor_from_class(cls, location, rotation):
        actor = cls(location, rotation)
        _actors.append(actor)
        return actor

    @staticmethod
    def spawn_actor_from_object(asset, location, rotation):
        actor = Actor(location, rotation)
        _actors.append(actor)
        return actor

    @staticmethod
    def get_editor_world():
        return "world"


class EditorAssetLibrary:
    @staticmethod
    def load_asset(path):
        return path if path.startswith("/Engine/") else None


class GameplayStatics:
    @staticmethod
    def get_all_actors_of_class(world, cls):
        return [a for a in _actors if isinstance(a, cls)]


def log(message):
    print(message)
