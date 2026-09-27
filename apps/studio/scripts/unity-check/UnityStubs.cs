// Just enough of UnityEngine and UnityEditor for the VCGS runtime and editor
// tools to compile outside Unity. The check runs the runtime's plain C#
// (Story, GameState, Rules, ScenePlayer, LevelLogic). GameObjects, components
// and transforms here are a small working model, so the level builder can
// build a level in memory and the check can look at what it built; rendering,
// physics and serialization are not modelled.
using System;
using System.Collections.Generic;

namespace UnityEngine
{
    public class Object
    {
        public string name = "";
        internal bool destroyed;
        public static void Destroy(Object o) => DestroyImmediate(o);
        public static void DontDestroyOnLoad(Object o) { }

        public static void DestroyImmediate(Object o)
        {
            if (o == null) return;
            if (o is GameObject go)
            {
                go.transform.SetParent(null);
                foreach (var child in new List<Transform>(go.transform.children)) DestroyImmediate(child.gameObject);
                go.destroyed = true;
                GameObject.all.Remove(go);
            }
            else if (o is Component c)
            {
                c.gameObject.components.Remove(c);
                c.destroyed = true;
            }
        }
    }

    public struct Vector3
    {
        public float x, y, z;
        public Vector3(float x, float y, float z) { this.x = x; this.y = y; this.z = z; }
        public static Vector3 zero => new Vector3(0, 0, 0);
        public static Vector3 one => new Vector3(1, 1, 1);
        public float sqrMagnitude => x * x + y * y + z * z;
        public float magnitude => (float)Math.Sqrt(sqrMagnitude);
        public Vector3 normalized => magnitude > 1e-6f ? this * (1 / magnitude) : zero;
        public static float Dot(Vector3 a, Vector3 b) => a.x * b.x + a.y * b.y + a.z * b.z;
        public static Vector3 Cross(Vector3 a, Vector3 b) => new Vector3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
        public static Vector3 operator +(Vector3 a, Vector3 b) => new Vector3(a.x + b.x, a.y + b.y, a.z + b.z);
        public static Vector3 operator -(Vector3 a, Vector3 b) => new Vector3(a.x - b.x, a.y - b.y, a.z - b.z);
        public static Vector3 operator *(Vector3 a, float k) => new Vector3(a.x * k, a.y * k, a.z * k);
        public static bool operator ==(Vector3 a, Vector3 b) => (a - b).sqrMagnitude < 1e-10f;
        public static bool operator !=(Vector3 a, Vector3 b) => !(a == b);
        public override bool Equals(object o) => o is Vector3 v && v == this;
        public override int GetHashCode() => x.GetHashCode() ^ y.GetHashCode() ^ z.GetHashCode();
        public override string ToString() => "(" + x + ", " + y + ", " + z + ")";
    }

    /// <summary>Only turns about the axes, kept as Euler angles.</summary>
    public struct Quaternion
    {
        public Vector3 euler;
        public static Quaternion Euler(float x, float y, float z) => new Quaternion { euler = new Vector3(x, (y % 360 + 360) % 360, z) };
    }

    public class GameObject : Object
    {
        internal static readonly List<GameObject> all = new List<GameObject>();
        internal readonly List<Component> components = new List<Component>();
        public readonly Transform transform;
        public string tag = "Untagged";
        public bool activeSelf { get; private set; } = true;
        public SceneManagement.Scene scene => default;

        public GameObject() : this("GameObject") { }

        public GameObject(string name)
        {
            this.name = name;
            transform = new Transform();
            transform.gameObject = this;
            components.Add(transform);
            all.Add(this);
        }

        public void SetActive(bool value) => activeSelf = value;

        public T AddComponent<T>() where T : Component, new()
        {
            var c = new T();
            c.gameObject = this;
            components.Add(c);
            return c;
        }

        public T GetComponent<T>() where T : class
        {
            foreach (var c in components) if (c is T t) return t;
            return null;
        }

        public T[] GetComponentsInChildren<T>(bool includeInactive) where T : class => transform.GetComponentsInChildren<T>(includeInactive);

        public static GameObject Find(string name) => all.Find(g => g.name == name && !g.destroyed);

        public static GameObject CreatePrimitive(PrimitiveType type)
        {
            var go = new GameObject(type.ToString());
            go.AddComponent<MeshFilter>();
            go.AddComponent<MeshRenderer>();
            if (type == PrimitiveType.Sphere) go.AddComponent<SphereCollider>();
            else if (type == PrimitiveType.Cylinder) go.AddComponent<CapsuleCollider>();
            else go.AddComponent<BoxCollider>();
            return go;
        }
    }

    public enum PrimitiveType { Sphere, Capsule, Cylinder, Cube, Plane, Quad }

    public class Component : Object
    {
        public GameObject gameObject;
        public Transform transform => gameObject.transform;
        public T GetComponent<T>() where T : class => gameObject.GetComponent<T>();
        public bool CompareTag(string tag) => gameObject.tag == tag;

        public T[] GetComponentsInChildren<T>(bool includeInactive) where T : class
        {
            var found = new List<T>();
            void Walk(Transform t)
            {
                foreach (var c in t.gameObject.components) if (c is T x) found.Add(x);
                foreach (var child in t.children) Walk(child);
            }
            Walk(transform);
            return found.ToArray();
        }
    }

    public class Transform : Component
    {
        internal readonly List<Transform> children = new List<Transform>();
        public Transform parent { get; private set; }
        public Vector3 localPosition = Vector3.zero;
        public Vector3 localScale = Vector3.one;
        public Vector3 localEulerAngles = Vector3.zero;
        public Quaternion localRotation
        {
            get => new Quaternion { euler = localEulerAngles };
            set => localEulerAngles = value.euler;
        }
        /// <summary>Parents' offsets added up (turns are not modelled).</summary>
        public Vector3 position => parent == null ? localPosition : parent.position + localPosition;
        public int childCount => children.Count;
        public Transform GetChild(int i) => children[i];

        public void SetParent(Transform p, bool worldPositionStays = true)
        {
            if (parent != null) parent.children.Remove(this);
            parent = p;
            if (p != null) p.children.Add(this);
        }

        public Transform Find(string name) => children.Find(c => c.gameObject.name == name);
    }

    public class Behaviour : Component { }

    public class MonoBehaviour : Behaviour { }

    public class ScriptableObject : Object { }

    public class TextAsset : Object
    {
        public string text = "";
    }

    public class Collider : Component { }

    public sealed class BoxCollider : Collider
    {
        public Vector3 size = Vector3.one;
        public Vector3 center = Vector3.zero;
        public bool isTrigger;
    }

    public sealed class SphereCollider : Collider { }

    public sealed class CapsuleCollider : Collider { }

    public sealed class MeshCollider : Collider
    {
        public Mesh sharedMesh;
    }

    public sealed class Mesh : Object
    {
        public Vector3[] vertices = new Vector3[0];
        public int[] triangles = new int[0];
        public void RecalculateNormals() { }
        public void RecalculateBounds() { }
    }

    public sealed class MeshFilter : Component
    {
        public Mesh sharedMesh;
    }

    public class Renderer : Component
    {
        public Material sharedMaterial;
    }

    public sealed class MeshRenderer : Renderer { }

    public sealed class Shader : Object
    {
        public static Shader Find(string name) => new Shader { name = name };
    }

    public sealed class Material : Object
    {
        public Color color = Color.white;
        public Material(Shader shader) { }
    }

    public enum LightType { Spot, Directional, Point }

    public sealed class Light : Behaviour
    {
        public LightType type = LightType.Point;
        public Color color = Color.white;
        public float intensity = 1;
        public float range = 10;
        public float spotAngle = 30;
    }

    public struct Color
    {
        public float r, g, b, a;
        public Color(float r, float g, float b, float a = 1) { this.r = r; this.g = g; this.b = b; this.a = a; }
        public static Color white => new Color(1, 1, 1, 1);
    }

    public static class Mathf
    {
        public static float Abs(float v) => Math.Abs(v);
        public static int RoundToInt(float v) => (int)Math.Round(v);
        public static float DeltaAngle(float a, float b)
        {
            var d = ((b - a) % 360 + 540) % 360 - 180;
            return d;
        }
    }

    public static class Time
    {
        public static float deltaTime = 1 / 60f;
    }

    public static class Debug
    {
        public static void Log(object message) => Console.WriteLine(message);
        public static void LogError(object message) => Console.Error.WriteLine(message);
    }

    [AttributeUsage(AttributeTargets.Field)]
    public sealed class SerializeField : Attribute { }

    [AttributeUsage(AttributeTargets.Field)]
    public sealed class TooltipAttribute : Attribute
    {
        public TooltipAttribute(string tooltip) { }
    }

    [AttributeUsage(AttributeTargets.Field)]
    public sealed class TextAreaAttribute : Attribute
    {
        public TextAreaAttribute() { }
        public TextAreaAttribute(int minLines, int maxLines) { }
    }

    [AttributeUsage(AttributeTargets.Class)]
    public sealed class CreateAssetMenuAttribute : Attribute
    {
        public string menuName = "";
    }

    [AttributeUsage(AttributeTargets.Class)]
    public sealed class DefaultExecutionOrder : Attribute
    {
        public DefaultExecutionOrder(int order) { }
    }
}

namespace UnityEngine.SceneManagement
{
    public struct Scene { }
}

namespace UnityEditor
{
    using UnityEngine;

    [AttributeUsage(AttributeTargets.Method)]
    public sealed class MenuItem : Attribute
    {
        public MenuItem(string path) { }
    }

    public static class EditorUtility
    {
        public static string OpenFilePanel(string title, string directory, string extension) => "";
    }

    public static class AssetDatabase
    {
        static readonly Dictionary<string, Object> assets = new Dictionary<string, Object>();
        static readonly HashSet<string> folders = new HashSet<string> { "Assets" };
        public static T LoadAssetAtPath<T>(string path) where T : Object => assets.TryGetValue(path, out var a) ? a as T : null;
        public static void CreateAsset(Object asset, string path) => assets[path] = asset;
        public static bool IsValidFolder(string path) => folders.Contains(path);
        public static string CreateFolder(string parent, string name)
        {
            folders.Add(parent + "/" + name);
            return "";
        }
    }

    public static class PrefabUtility
    {
        public static Object InstantiatePrefab(Object prefab) => new GameObject(prefab.name);
    }

    public static class Undo
    {
        public static void RegisterCreatedObjectUndo(Object o, string name) { }
    }
}

namespace UnityEditor.SceneManagement
{
    public static class EditorSceneManager
    {
        public static bool MarkSceneDirty(UnityEngine.SceneManagement.Scene scene) => true;
    }
}
