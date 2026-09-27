// Just enough of UnrealBuildTool for VCGS.Build.cs to compile.
namespace UnrealBuildTool
{
    public class ReadOnlyTargetRules { }
    public enum PCHUsageMode { UseExplicitOrSharedPCHs }
    public class ModuleRules
    {
        public ModuleRules(ReadOnlyTargetRules target) { }
        public PCHUsageMode PCHUsage;
        public System.Collections.Generic.List<string> PublicDependencyModuleNames = new System.Collections.Generic.List<string>();
    }
}
