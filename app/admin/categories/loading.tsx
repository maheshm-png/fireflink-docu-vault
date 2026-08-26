import BrandedLoader from "@/components/BrandedLoader";

export default function Loading() {
  return (
    <div className="flex h-screen items-center justify-center bg-[#FBF8FA]">
      <BrandedLoader size={40} label="Loading..." />
    </div>
  );
}
