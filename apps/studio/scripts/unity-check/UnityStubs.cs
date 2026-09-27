// Just enough of UnityEngine for the VCGS runtime to compile outside Unity.
// The check runs the runtime's plain C# (Story, GameState, Rules, ScenePlayer);
// the MonoBehaviour and ScriptableObject wrappers only have to compile.
using System;

namespace UnityEngine
{
    public class Object
    {
        public string name = "";
        public static void Destroy(Object o) { }
        public static void DontDestroyOnLoad(Object o) { }
    }

    public class GameObject : Object { }

    public class Component : Object
    {
        public GameObject gameObject = new GameObject();
    }

    public class Behaviour : Component { }

    public class MonoBehaviour : Behaviour { }

    public class ScriptableObject : Object { }

    public class TextAsset : Object
    {
        public string text = "";
    }

    public struct Color
    {
        public float r, g, b, a;
        public Color(float r, float g, float b, float a = 1) { this.r = r; this.g = g; this.b = b; this.a = a; }
        public static Color white => new Color(1, 1, 1, 1);
    }

    public static class Debug
    {
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
