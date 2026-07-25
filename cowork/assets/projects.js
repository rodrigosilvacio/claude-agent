// Cowork — camada de dados para projetos e arquivos de referência.
import { supabase } from "./supabaseClient.js";

export async function listProjects() {
  const { data, error } = await supabase
    .from("cowork_projects")
    .select("id, name, instructions, created_at")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

export async function createProject(ownerId, name) {
  const { data, error } = await supabase
    .from("cowork_projects")
    .insert([{ owner_id: ownerId, name, instructions: "" }])
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function renameProject(id, name) {
  const { error } = await supabase.from("cowork_projects").update({ name }).eq("id", id);
  if (error) throw error;
}

export async function updateInstructions(id, instructions) {
  const { error } = await supabase.from("cowork_projects").update({ instructions }).eq("id", id);
  if (error) throw error;
}

export async function deleteProject(id) {
  const { error } = await supabase.from("cowork_projects").delete().eq("id", id);
  if (error) throw error;
}

export async function listReferenceFiles(projectId) {
  const { data, error } = await supabase
    .from("cowork_reference_files")
    .select("id, file_name, file_path, file_type, file_size, extracted_text, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

// `extraction` vem de fileExtract.js: { kind: "native"|"text", mediaType, text? }
export async function uploadReferenceFile(ownerId, projectId, file, extraction) {
  const path = `${ownerId}/${projectId}/${crypto.randomUUID()}-${file.name}`;
  const { error: uploadError } = await supabase.storage.from("cowork-references").upload(path, file, {
    contentType: extraction.mediaType || file.type || "application/octet-stream",
  });
  if (uploadError) throw uploadError;

  const { data, error } = await supabase
    .from("cowork_reference_files")
    .insert([
      {
        project_id: projectId,
        owner_id: ownerId,
        file_name: file.name,
        file_path: path,
        file_type: extraction.mediaType || file.type || "application/octet-stream",
        file_size: file.size,
        extracted_text: extraction.kind === "text" ? extraction.text : null,
      },
    ])
    .select()
    .single();
  if (error) {
    await supabase.storage.from("cowork-references").remove([path]);
    throw error;
  }
  return data;
}

export async function deleteReferenceFile(file) {
  await supabase.storage.from("cowork-references").remove([file.file_path]);
  const { error } = await supabase.from("cowork_reference_files").delete().eq("id", file.id);
  if (error) throw error;
}
